use crate::{CommandPreview, ConnectionView, NetworkConfig};
use anyhow::{anyhow, bail, Context};
use chrono::Utc;
use std::{
    fmt::Display,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
};
use tokio::runtime::Runtime;
use vnt_core::{
    api::VntApi,
    core::{NetworkManager, RegisterResponse},
    nat::NetInput,
    utils::task_control::{TaskGroupGuard, TaskGroupManager},
};

const LOG_LIMIT: usize = 300;

pub struct EmbeddedConnection {
    pub item_key: String,
    pub config_name: String,
    pub core_mode: String,
    pub temporary_exit_ip: Option<String>,
    pub temporary_exit_name: Option<String>,
    pub started_at: String,
    pub command_preview: Vec<String>,
    pub logs: Arc<Mutex<Vec<String>>>,
    pub last_error: Arc<Mutex<Option<String>>>,
    network_manager: Mutex<Option<NetworkManager>>,
    runtime: Option<Runtime>,
    task_group_manager: Option<TaskGroupManager>,
    guard: Option<TaskGroupGuard>,
    api: Option<VntApi>,
}

impl EmbeddedConnection {
    pub fn placeholder(config: NetworkConfig, command_preview: CommandPreview) -> Self {
        let logs = Arc::new(Mutex::new(Vec::new()));
        push_log(&logs, "[app] Embedded VNT placeholder started".to_string());

        Self {
            item_key: config.item_key,
            config_name: config.config_name,
            core_mode: config.core_mode,
            temporary_exit_ip: None,
            temporary_exit_name: None,
            started_at: Utc::now().to_rfc3339(),
            command_preview: command_preview.display,
            logs,
            last_error: Arc::new(Mutex::new(None)),
            network_manager: Mutex::new(None),
            runtime: None,
            task_group_manager: None,
            guard: None,
            api: None,
        }
    }

    pub fn start(
        mut config: NetworkConfig,
        temporary_exit: Option<(String, String)>,
    ) -> anyhow::Result<Self> {
        let command_preview = crate::embedded::preview::command_preview(&config);
        let logs = Arc::new(Mutex::new(Vec::new()));
        let last_error = Arc::new(Mutex::new(None));
        push_log(
            &logs,
            format!("[app] Starting embedded VNT {}", command_preview.display.join(" ")),
        );

        if let Some((exit_ip, _)) = temporary_exit.as_ref() {
            let route = temporary_exit_in_ip(exit_ip)?;
            push_log(&logs, format!("[app] Temporary exit route: {route}"));
            config.in_ips.push(route);
        }

        let core_config = crate::embedded::config::to_core_config(&config)
            .inspect_err(|error| record_error(&logs, &last_error, error))?;

        let runtime = Runtime::new()
            .inspect_err(|error| record_error(&logs, &last_error, error))
            .context("create embedded VNT tokio runtime")?;
        let task_group_manager = TaskGroupManager::new();
        let (task_group, guard) = task_group_manager
            .create_task()
            .inspect_err(|error| record_error(&logs, &last_error, error))
            .context("create embedded VNT task group")?;

        let (network_manager, api) = runtime.block_on(async {
            let mut network_manager =
                NetworkManager::create_network(Box::new(core_config), task_group)
                    .await
                    .context("create embedded VNT network")?;
            let register_response = network_manager
                .register()
                .await
                .context("register embedded VNT network")?;
            let network = match register_response {
                RegisterResponse::Success(network) => network,
                RegisterResponse::Failed(error) => {
                    bail!(
                        "embedded VNT registration failed ({}): {}",
                        error.code,
                        error.message
                    );
                }
            };
            push_log(
                &logs,
                format!(
                    "[app] Registration succeeded: {}/{}",
                    network.ip, network.prefix_len
                ),
            );

            if network_manager.is_no_tun() {
                push_log(&logs, "[app] no_tun enabled; skipping TUN startup".to_string());
            } else {
                crate::embedded::platform::start_tun(&mut network_manager, network)
                    .await
                    .context("start embedded VNT TUN")?;
                push_log(&logs, "[app] TUN started".to_string());
            }

            let api = network_manager.vnt_api();
            anyhow::Ok((network_manager, api))
        })
        .inspect_err(|error| {
            task_group_manager.stop();
            record_error(&logs, &last_error, error);
        })?;

        Ok(Self {
            item_key: config.item_key,
            config_name: config.config_name,
            core_mode: config.core_mode,
            temporary_exit_ip: temporary_exit.as_ref().map(|(ip, _)| ip.clone()),
            temporary_exit_name: temporary_exit.as_ref().map(|(_, name)| name.clone()),
            started_at: Utc::now().to_rfc3339(),
            command_preview: command_preview.display,
            logs,
            last_error,
            network_manager: Mutex::new(Some(network_manager)),
            runtime: Some(runtime),
            task_group_manager: Some(task_group_manager),
            guard: Some(guard),
            api: Some(api),
        })
    }

    pub fn view(&self) -> ConnectionView {
        ConnectionView {
            item_key: self.item_key.clone(),
            config_name: self.config_name.clone(),
            core_mode: self.core_mode.clone(),
            status: "connected".to_string(),
            temporary_exit_ip: self.temporary_exit_ip.clone(),
            temporary_exit_name: self.temporary_exit_name.clone(),
            pid: None,
            started_at: self.started_at.clone(),
            command_preview: self.command_preview.clone(),
            logs: self.logs.lock().map(|logs| logs.clone()).unwrap_or_default(),
            last_error: self.last_error.lock().ok().and_then(|error| error.clone()),
            exit_code: None,
        }
    }

    pub fn api(&self) -> Option<VntApi> {
        self.api.clone()
    }

    pub fn stop(&self) {
        if let Some(task_group_manager) = &self.task_group_manager {
            task_group_manager.stop();
        }
        take_network_manager(&self.network_manager);
    }
}

impl Drop for EmbeddedConnection {
    fn drop(&mut self) {
        if let Some(task_group_manager) = &self.task_group_manager {
            task_group_manager.stop();
        }
        take_network_manager(&self.network_manager);
        self.guard.take();
        self.runtime.take();
    }
}

fn temporary_exit_in_ip(device_ip: &str) -> anyhow::Result<String> {
    let ip = device_ip.trim();
    if ip.is_empty() {
        bail!("temporary exit IP is required");
    }
    ip.parse::<Ipv4Addr>()
        .map_err(|_| anyhow!("temporary exit IP must be a valid virtual IPv4"))?;
    let route = format!("0.0.0.0/0,{ip}");
    route
        .parse::<NetInput>()
        .map_err(|error| anyhow!("invalid temporary exit route '{route}': {error}"))?;
    Ok(route)
}

fn push_log(logs: &Arc<Mutex<Vec<String>>>, message: String) {
    if let Ok(mut logs) = logs.lock() {
        logs.push(message);
        if logs.len() > LOG_LIMIT {
            let overflow = logs.len() - LOG_LIMIT;
            logs.drain(0..overflow);
        }
    }
}

fn take_network_manager(network_manager: &Mutex<Option<NetworkManager>>) {
    match network_manager.lock() {
        Ok(mut network_manager) => {
            network_manager.take();
        }
        Err(poisoned) => {
            poisoned.into_inner().take();
        }
    }
}

fn record_error<E: Display + ?Sized>(
    logs: &Arc<Mutex<Vec<String>>>,
    last_error: &Arc<Mutex<Option<String>>>,
    error: &E,
) {
    let message = error.to_string();
    if let Ok(mut last_error) = last_error.lock() {
        *last_error = Some(message.clone());
    }
    push_log(logs, format!("[err] {message}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> crate::NetworkConfig {
        crate::NetworkConfig {
            item_key: "item".to_string(),
            config_name: "cfg".to_string(),
            token: "mesh-code".to_string(),
            device_name: "device-a".to_string(),
            virtual_ipv4: "10.26.0.8".to_string(),
            server_address: "example.com:29872".to_string(),
            stun_servers: vec!["stun.example.com".to_string()],
            in_ips: vec!["192.168.1.0/24,10.26.0.2".to_string()],
            out_ips: vec!["0.0.0.0/0".to_string()],
            port_mappings: vec![
                "tcp://0.0.0.0:8080-10.26.0.2-192.168.1.10:80".to_string(),
            ],
            group_password: "secret".to_string(),
            is_server_encrypted: true,
            protocol: "UDP".to_string(),
            data_fingerprint_verification: false,
            encryption_algorithm: "aes_gcm".to_string(),
            device_id: "dev-id".to_string(),
            virtual_network_card_name: "vnt-tun".to_string(),
            mtu: 1380,
            ports: vec![],
            first_latency: false,
            no_in_ip_proxy: true,
            dns: vec![],
            simulated_packet_loss_rate: 0.0,
            simulated_latency: 0,
            punch_model: "all".to_string(),
            use_channel_type: "all".to_string(),
            compressor: "lz4".to_string(),
            core_mode: "tun".to_string(),
            local_dev: String::new(),
            disable_stats: false,
            allow_wg: false,
            vnt_mappings: vec![],
            no_tun: false,
            rtx: true,
            fec: true,
            no_punch: false,
            allow_port_mapping: true,
            tunnel_port: Some(30000),
            cert_mode: "skip".to_string(),
        }
    }

    #[test]
    fn placeholder_view_has_no_pid() {
        let preview = CommandPreview {
            executable: "embedded-vnt-core".to_string(),
            args: vec!["--no-tun".to_string()],
            display: vec!["embedded-vnt-core".to_string(), "--no-tun".to_string()],
        };
        let connection = EmbeddedConnection::placeholder(config(), preview);
        let view = connection.view();

        assert_eq!(view.pid, None);
        assert_eq!(view.status, "connected");
    }
}

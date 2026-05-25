#[cfg(target_os = "ios")]
mod ios {
    use std::collections::HashMap;
    use std::os::raw::{c_char, c_uchar};
    use std::sync::{Mutex, OnceLock};

    use tokio::runtime::Runtime;
    use tokio::sync::mpsc::{self, Sender};
    use vnt_core::{
        context::config::Config as CoreConfig,
        core::{NetworkManager, RegisterResponse},
        tun::PacketFlowDevice,
        utils::task_control::{TaskGroupGuard, TaskGroupManager},
    };

    use crate::{ios_vpn::IosVpnProfile, NetworkConfig};

    type PacketWriteCallback = extern "C" fn(u64, *const c_uchar, usize);

    struct IosPacketFlowSession {
        network_manager: NetworkManager,
        runtime: Runtime,
        task_group_manager: TaskGroupManager,
        guard: TaskGroupGuard,
        packet_tx: Sender<Vec<u8>>,
    }

    static SESSIONS: OnceLock<Mutex<HashMap<u64, IosPacketFlowSession>>> = OnceLock::new();

    #[no_mangle]
    pub extern "C" fn vnt_ios_packet_flow_start(
        profile_json: *const c_char,
        packet_writer: Option<PacketWriteCallback>,
    ) -> u64 {
        let result = std::panic::catch_unwind(|| start(profile_json, packet_writer));
        match result {
            Ok(Ok(session_id)) => session_id,
            Ok(Err(error)) => {
                log::error!("start iOS packet flow failed: {error:#}");
                0
            }
            Err(_) => {
                log::error!("start iOS packet flow panicked");
                0
            }
        }
    }

    #[no_mangle]
    pub extern "C" fn vnt_ios_packet_flow_push(
        session_id: u64,
        packet_ptr: *const c_uchar,
        packet_len: usize,
    ) {
        if session_id == 0 || packet_ptr.is_null() || packet_len == 0 {
            return;
        }
        let packet = unsafe { std::slice::from_raw_parts(packet_ptr, packet_len) }.to_vec();
        let Some(lock) = SESSIONS.get() else {
            return;
        };
        if let Ok(sessions) = lock.lock() {
            if let Some(session) = sessions.get(&session_id) {
                let _ = session.packet_tx.try_send(packet);
            }
        }
    }

    #[no_mangle]
    pub extern "C" fn vnt_ios_packet_flow_stop(session_id: u64) {
        let Some(lock) = SESSIONS.get() else {
            return;
        };
        if let Ok(mut sessions) = lock.lock() {
            if let Some(session) = sessions.remove(&session_id) {
                session.task_group_manager.stop();
                drop(session);
            }
        }
    }

    fn start(
        profile_json: *const c_char,
        packet_writer: Option<PacketWriteCallback>,
    ) -> anyhow::Result<u64> {
        if profile_json.is_null() {
            anyhow::bail!("missing iOS packet flow profile");
        }
        let profile_json = unsafe { std::ffi::CStr::from_ptr(profile_json) }
            .to_string_lossy()
            .to_string();
        let profile: IosVpnProfile = serde_json::from_str(&profile_json)?;
        let network_config = network_config_from_profile(profile);
        let core_config: CoreConfig = crate::embedded::config::to_core_config(&network_config)?;

        let runtime = Runtime::new()?;
        let task_group_manager = TaskGroupManager::new();
        let (task_group, guard) = task_group_manager.create_task()?;
        let (packet_tx, packet_rx) = mpsc::channel::<Vec<u8>>(1024);
        let session_id = next_session_id();

        let network_manager = runtime.block_on(async {
            let mut network_manager = NetworkManager::create_network(Box::new(core_config), task_group)
                .await?;
            match network_manager.register().await? {
                RegisterResponse::Success(_) => {}
                RegisterResponse::Failed(error) => {
                    anyhow::bail!("embedded VNT registration failed ({}): {}", error.code, error.message);
                }
            }

            let packet_flow = PacketFlowDevice::new(packet_rx, move |packet| {
                if let Some(packet_writer) = packet_writer {
                    packet_writer(session_id, packet.as_ptr(), packet.len());
                }
            });
            network_manager.start_packet_flow(packet_flow).await?;
            anyhow::Ok(network_manager)
        })?;

        let session = IosPacketFlowSession {
            network_manager,
            runtime,
            task_group_manager,
            guard,
            packet_tx,
        };
        let lock = SESSIONS.get_or_init(|| Mutex::new(HashMap::new()));
        lock.lock()
            .map_err(|_| anyhow::anyhow!("iOS packet flow session lock poisoned"))?
            .insert(session_id, session);

        Ok(session_id)
    }

    fn network_config_from_profile(profile: IosVpnProfile) -> NetworkConfig {
        NetworkConfig {
            item_key: profile.item_key,
            config_name: profile.config_name,
            token: profile.token,
            device_name: profile.device_name,
            virtual_ipv4: profile.virtual_ipv4,
            server_address: profile.server_address,
            stun_servers: Vec::new(),
            in_ips: Vec::new(),
            out_ips: profile.out_ips,
            port_mappings: Vec::new(),
            group_password: profile.group_password,
            is_server_encrypted: true,
            protocol: profile.protocol,
            data_fingerprint_verification: false,
            encryption_algorithm: "aes_gcm".to_string(),
            device_id: profile.device_id,
            virtual_network_card_name: "vnt-ios".to_string(),
            mtu: profile.mtu,
            ports: Vec::new(),
            first_latency: false,
            no_in_ip_proxy: true,
            dns: profile.dns,
            simulated_packet_loss_rate: 0.0,
            simulated_latency: 0,
            punch_model: "all".to_string(),
            use_channel_type: "relay".to_string(),
            compressor: profile.compressor,
            core_mode: "tun".to_string(),
            local_dev: String::new(),
            disable_stats: false,
            allow_wg: false,
            vnt_mappings: Vec::new(),
            no_tun: false,
            rtx: profile.rtx,
            fec: profile.fec,
            no_punch: true,
            allow_port_mapping: false,
            tunnel_port: None,
            cert_mode: profile.cert_mode,
        }
    }

    fn next_session_id() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(1);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }
}

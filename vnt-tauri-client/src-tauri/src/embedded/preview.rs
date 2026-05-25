use crate::{CommandPreview, NetworkConfig};

const EXECUTABLE: &str = "embedded-vnt-core";

pub fn command_preview(config: &NetworkConfig) -> CommandPreview {
    let raw_args = build_args(config);
    let args = redacted_args(&raw_args);
    let mut display = vec![EXECUTABLE.to_string()];
    display.extend(args.clone());

    CommandPreview {
        executable: EXECUTABLE.to_string(),
        args,
        display,
    }
}

fn build_args(config: &NetworkConfig) -> Vec<String> {
    let mut args = Vec::new();

    push_pair(&mut args, "--network-code", &config.token);
    push_pair(&mut args, "--device-name", &config.device_name);
    push_pair(&mut args, "--server", &config.server_address);
    push_pair(&mut args, "--password", &config.group_password);
    push_pair(&mut args, "--ip", &config.virtual_ipv4);

    if config.no_tun {
        args.push("--no-tun".to_string());
    }
    if config.rtx {
        args.push("--rtx".to_string());
    }
    if config.fec {
        args.push("--fec".to_string());
    }
    if config.no_punch || config.use_channel_type == "relay" {
        args.push("--no-punch".to_string());
    }
    if config.allow_port_mapping {
        args.push("--allow-port-mapping".to_string());
    }
    if let Some(tunnel_port) = config.tunnel_port.filter(|port| *port > 0) {
        args.push("--tunnel-port".to_string());
        args.push(tunnel_port.to_string());
    }
    push_pair(&mut args, "--cert-mode", &config.cert_mode);
    if config.compressor != "none" && !config.compressor.trim().is_empty() {
        args.push("--compress".to_string());
    }

    args
}

fn push_pair(args: &mut Vec<String>, key: &str, value: &str) {
    if !value.trim().is_empty() {
        args.push(key.to_string());
        args.push(value.trim().to_string());
    }
}

fn redacted_args(args: &[String]) -> Vec<String> {
    let mut redacted = Vec::with_capacity(args.len());
    let mut redact_next = false;

    for arg in args {
        if redact_next {
            redacted.push("******".to_string());
            redact_next = false;
            continue;
        }
        redacted.push(arg.clone());
        if matches!(arg.as_str(), "--network-code" | "--password") {
            redact_next = true;
        }
    }

    redacted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> NetworkConfig {
        NetworkConfig {
            item_key: "item".to_string(),
            config_name: "cfg".to_string(),
            token: "mesh-code".to_string(),
            device_name: "device-a".to_string(),
            virtual_ipv4: "10.26.0.8".to_string(),
            server_address: "example.com:29872".to_string(),
            stun_servers: vec![],
            in_ips: vec![],
            out_ips: vec![],
            port_mappings: vec![],
            group_password: "secret".to_string(),
            is_server_encrypted: true,
            protocol: "UDP".to_string(),
            data_fingerprint_verification: false,
            encryption_algorithm: "aes_gcm".to_string(),
            device_id: "dev-id".to_string(),
            virtual_network_card_name: String::new(),
            mtu: 1380,
            ports: vec![],
            first_latency: false,
            no_in_ip_proxy: false,
            dns: vec![],
            simulated_packet_loss_rate: 0.0,
            simulated_latency: 0,
            punch_model: "all".to_string(),
            use_channel_type: "all".to_string(),
            compressor: "none".to_string(),
            core_mode: "tun".to_string(),
            local_dev: String::new(),
            disable_stats: false,
            allow_wg: false,
            vnt_mappings: vec![],
            no_tun: false,
            rtx: false,
            fec: false,
            no_punch: false,
            allow_port_mapping: false,
            tunnel_port: None,
            cert_mode: "skip".to_string(),
        }
    }

    fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|index| args.get(index + 1))
            .map(String::as_str)
    }

    #[test]
    fn command_preview_uses_embedded_core_and_redacts_network_code() {
        let preview = command_preview(&config());

        assert_eq!(preview.executable, "embedded-vnt-core");
        assert_eq!(value_after(&preview.args, "--network-code"), Some("******"));
        assert_eq!(value_after(&preview.args, "--device-name"), Some("device-a"));
        assert_eq!(
            value_after(&preview.args, "--server"),
            Some("example.com:29872")
        );
        assert_eq!(value_after(&preview.args, "--password"), Some("******"));
        assert_eq!(value_after(&preview.args, "--ip"), Some("10.26.0.8"));
        assert!(preview.display.contains(&"--network-code".to_string()));
        assert!(preview.display.contains(&"******".to_string()));
        assert_eq!(value_after(&preview.display, "--network-code"), Some("******"));
        assert_eq!(value_after(&preview.display, "--password"), Some("******"));
        assert!(!preview.args.contains(&"mesh-code".to_string()));
        assert!(!preview.args.contains(&"secret".to_string()));
        assert!(!preview.display.contains(&"mesh-code".to_string()));
        assert!(!preview.display.contains(&"secret".to_string()));
        assert!(!preview.display.iter().any(|arg| arg.contains("vnt-cli")));
    }

    #[test]
    fn command_preview_omits_empty_optional_values() {
        let mut cfg = config();
        cfg.group_password = String::new();
        cfg.virtual_ipv4 = String::new();
        cfg.compressor = "none".to_string();
        cfg.no_tun = false;
        cfg.rtx = false;
        cfg.fec = false;

        let preview = command_preview(&cfg);

        for flag in [
            "--password",
            "--ip",
            "--compress",
            "--no-tun",
            "--rtx",
            "--fec",
        ] {
            assert!(!preview.args.contains(&flag.to_string()));
            assert!(!preview.display.contains(&flag.to_string()));
        }
    }

    #[test]
    fn command_preview_includes_embedded_feature_flags() {
        let mut cfg = config();
        cfg.no_tun = true;
        cfg.rtx = true;
        cfg.fec = true;
        cfg.no_punch = true;
        cfg.allow_port_mapping = true;
        cfg.tunnel_port = Some(30000);
        cfg.compressor = "lz4".to_string();

        let preview = command_preview(&cfg);

        assert!(preview.display.contains(&"--no-tun".to_string()));
        assert!(preview.display.contains(&"--rtx".to_string()));
        assert!(preview.display.contains(&"--fec".to_string()));
        assert!(preview.display.contains(&"--no-punch".to_string()));
        assert!(preview.display.contains(&"--allow-port-mapping".to_string()));
        assert_eq!(value_after(&preview.display, "--tunnel-port"), Some("30000"));
        assert_eq!(value_after(&preview.display, "--cert-mode"), Some("skip"));
        assert!(preview.display.contains(&"--compress".to_string()));
    }
}

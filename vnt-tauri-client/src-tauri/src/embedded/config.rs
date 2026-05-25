use crate::NetworkConfig;
use anyhow::{anyhow, Context};
use ipnet::Ipv4Net;
use vnt_core::{
    context::config::Config as CoreConfig,
    nat::NetInput,
    port_mapping::PortMapping,
    tls::verifier::CertValidationMode,
    tunnel_core::server::transport::config::ProtocolAddress,
};

pub fn to_core_config(config: &NetworkConfig) -> anyhow::Result<CoreConfig> {
    let server_addr = parse_server_address(config)?;
    let input = compact_list(&config.in_ips)
        .into_iter()
        .map(|value| {
            value
                .parse::<NetInput>()
                .map_err(|error| anyhow!("invalid input route '{value}': {error}"))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let output = compact_list(&config.out_ips)
        .into_iter()
        .map(|value| {
            value
                .parse::<Ipv4Net>()
                .with_context(|| format!("invalid output route '{value}'"))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let port_mapping = compact_list(&config.port_mappings)
        .into_iter()
        .map(|value| {
            value
                .parse::<PortMapping>()
                .map_err(|error| anyhow!("invalid port mapping '{value}': {error}"))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let ip = if config.virtual_ipv4.trim().is_empty() {
        None
    } else {
        Some(
            config
                .virtual_ipv4
                .trim()
                .parse()
                .with_context(|| format!("invalid virtual IPv4 '{}'", config.virtual_ipv4))?,
        )
    };
    let mtu = if config.mtu > 0 {
        Some(u16::try_from(config.mtu).context("mtu is out of u16 range")?)
    } else {
        None
    };
    let tunnel_port = config.tunnel_port.filter(|port| *port > 0);
    let mut udp_stun = compact_list(&config.stun_servers);
    for stun in &mut udp_stun {
        if !stun.contains(':') {
            stun.push_str(":3478");
        }
    }

    let core = CoreConfig {
        server_addr,
        cert_mode: parse_cert_mode(&config.cert_mode)?,
        network_code: config.token.trim().to_string(),
        device_id: config.device_id.trim().to_string(),
        device_name: config.device_name.trim().to_string(),
        tun_name: non_empty(config.virtual_network_card_name.trim()),
        ip,
        password: non_empty(config.group_password.trim()),
        no_punch: config.no_punch || config.use_channel_type == "relay",
        compress: config.compressor != "none" && !config.compressor.trim().is_empty(),
        rtx: config.rtx,
        fec: config.fec,
        input,
        output,
        no_nat: config.no_in_ip_proxy,
        no_tun: config.no_tun,
        mtu,
        port_mapping,
        allow_port_mapping: config.allow_port_mapping,
        udp_stun,
        tcp_stun: Vec::new(),
        tunnel_port,
    };
    core.check()?;
    Ok(core)
}

fn parse_server_address(config: &NetworkConfig) -> anyhow::Result<Vec<ProtocolAddress>> {
    let raw = config.server_address.trim();
    if raw.is_empty() {
        return Err(anyhow!("server address is required"));
    }
    let uri = if raw.contains("://") {
        raw.to_string()
    } else {
        match config.protocol.as_str() {
            "UDP" => format!("quic://{raw}"),
            "TCP" => format!("tcp://{raw}"),
            "WSS" => format!("wss://{raw}"),
            "WS" => return Err(anyhow!("WS protocol is not supported by embedded VNT 2")),
            other => return Err(anyhow!("unsupported protocol '{other}'")),
        }
    };
    Ok(vec![uri
        .parse::<ProtocolAddress>()
        .map_err(|error| anyhow!("invalid server address '{uri}': {error}"))?])
}

fn parse_cert_mode(value: &str) -> anyhow::Result<CertValidationMode> {
    if value.trim().is_empty() {
        return Ok(CertValidationMode::InsecureSkipVerification);
    }
    value
        .parse()
        .map_err(|error| anyhow!("invalid cert mode '{}': {}", value, error))
}

fn compact_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
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
    fn udp_legacy_server_address_maps_to_quic_uri() {
        let cfg = config();
        let server = parse_server_address(&cfg).expect("server");
        assert_eq!(server.len(), 1);
        assert_eq!(server[0].to_string(), "quic://example.com:29872");
    }

    #[test]
    fn tcp_server_address_maps_to_tcp_uri() {
        let mut cfg = config();
        cfg.protocol = "TCP".to_string();
        let server = parse_server_address(&cfg).expect("server");
        assert_eq!(server[0].to_string(), "tcp://example.com:29872");
    }

    #[test]
    fn conversion_maps_primary_fields() {
        let cfg = config();
        let core = to_core_config(&cfg).expect("core config");
        assert_eq!(core.network_code, "mesh-code");
        assert_eq!(core.device_id, "dev-id");
        assert_eq!(core.device_name, "device-a");
        assert_eq!(core.server_addr[0].to_string(), "quic://example.com:29872");
        assert_eq!(core.ip.unwrap().to_string(), "10.26.0.8");
        assert_eq!(core.tun_name.as_deref(), Some("vnt-tun"));
        assert_eq!(core.mtu, Some(1380));
        assert_eq!(core.input.len(), 1);
        assert_eq!(core.output.len(), 1);
        assert_eq!(core.port_mapping.len(), 1);
        assert_eq!(core.password.as_deref(), Some("secret"));
        assert_eq!(core.cert_mode.to_string(), "skip");
        assert!(core.compress);
        assert!(core.rtx);
        assert!(core.fec);
        assert!(core.no_nat);
        assert!(core.allow_port_mapping);
        assert_eq!(core.udp_stun, vec!["stun.example.com:3478"]);
        assert!(core.tcp_stun.is_empty());
        assert_eq!(core.tunnel_port, Some(30000));
    }

    #[test]
    fn relay_channel_sets_no_punch() {
        let mut cfg = config();
        cfg.use_channel_type = "relay".to_string();
        let core = to_core_config(&cfg).expect("core config");
        assert!(core.no_punch);
    }

    #[test]
    fn conversion_maps_no_tun() {
        let mut cfg = config();
        cfg.no_tun = true;
        let core = to_core_config(&cfg).expect("core config");
        assert!(core.no_tun);
    }

    #[test]
    fn empty_cert_mode_defaults_to_skip() {
        let cert_mode = parse_cert_mode("").expect("cert mode");
        assert_eq!(cert_mode.to_string(), "skip");
    }

    #[test]
    fn conversion_rejects_too_large_mtu() {
        let mut cfg = config();
        cfg.mtu = 1600;
        assert!(to_core_config(&cfg).is_err());
    }
}

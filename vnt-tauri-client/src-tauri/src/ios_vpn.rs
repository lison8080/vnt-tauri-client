use crate::NetworkConfig;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosVpnProfile {
    pub item_key: String,
    pub config_name: String,
    pub token: String,
    pub device_name: String,
    pub device_id: String,
    pub virtual_ipv4: String,
    pub server_address: String,
    pub protocol: String,
    pub group_password: String,
    pub mtu: u32,
    pub rtx: bool,
    pub fec: bool,
    pub cert_mode: String,
    pub compressor: String,
    pub out_ips: Vec<String>,
    pub dns: Vec<String>,
}

impl From<&NetworkConfig> for IosVpnProfile {
    fn from(config: &NetworkConfig) -> Self {
        Self {
            item_key: config.item_key.clone(),
            config_name: config.config_name.clone(),
            token: config.token.clone(),
            device_name: config.device_name.clone(),
            device_id: config.device_id.clone(),
            virtual_ipv4: config.virtual_ipv4.clone(),
            server_address: config.server_address.clone(),
            protocol: config.protocol.clone(),
            group_password: config.group_password.clone(),
            mtu: config.mtu,
            rtx: config.rtx,
            fec: config.fec,
            cert_mode: config.cert_mode.clone(),
            compressor: config.compressor.clone(),
            out_ips: config.out_ips.clone(),
            dns: config.dns.clone(),
        }
    }
}

mod native {
    use super::IosVpnProfile;

    pub fn start(_profile: &IosVpnProfile) -> anyhow::Result<()> {
        anyhow::bail!(
            "iOS NetworkExtension target is not linked in this build; configure Apple signing and enable the PacketTunnelProvider target"
        )
    }

    pub fn stop() -> anyhow::Result<()> {
        Ok(())
    }
}

pub fn start(profile: &IosVpnProfile) -> anyhow::Result<()> {
    native::start(profile)
}

pub fn stop() -> anyhow::Result<()> {
    native::stop()
}

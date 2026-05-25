use vnt_core::{context::NetworkAddr, core::NetworkManager};

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub async fn start_tun(
    network_manager: &mut NetworkManager,
    network: NetworkAddr,
) -> anyhow::Result<()> {
    network_manager.start_tun().await?;
    set_tun_network_ip(network_manager, network).await
}

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub async fn set_tun_network_ip(
    network_manager: &NetworkManager,
    network: NetworkAddr,
) -> anyhow::Result<()> {
    network_manager
        .set_tun_network_ip(network.ip, network.prefix_len)
        .await
}

#[cfg(target_os = "android")]
pub async fn start_tun(
    _network_manager: &mut NetworkManager,
    _network: NetworkAddr,
) -> anyhow::Result<()> {
    anyhow::bail!(
        "Android VNT 2 VPN fd bridge is not wired yet; enable no_tun or finish the JNI VpnService bridge"
    )
}

#[cfg(target_os = "android")]
pub async fn set_tun_network_ip(
    _network_manager: &NetworkManager,
    _network: NetworkAddr,
) -> anyhow::Result<()> {
    anyhow::bail!(
        "Android VNT 2 VPN fd bridge is not wired yet; enable no_tun or finish the JNI VpnService bridge"
    )
}

#[cfg(target_os = "ios")]
pub async fn start_tun(
    _network_manager: &mut NetworkManager,
    _network: NetworkAddr,
) -> anyhow::Result<()> {
    anyhow::bail!(
        "iOS embedded VNT 2 TUN integration is not wired yet; NetworkExtension packet-flow bridge is required"
    )
}

#[cfg(target_os = "ios")]
pub async fn set_tun_network_ip(
    _network_manager: &NetworkManager,
    _network: NetworkAddr,
) -> anyhow::Result<()> {
    anyhow::bail!(
        "iOS embedded VNT 2 TUN integration is not wired yet; NetworkExtension packet-flow bridge is required"
    )
}

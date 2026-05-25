use crate::{CoreChart, CoreDevice, CoreInfo, CoreRoute, NetworkOverview};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use vnt_core::api::VntApi;

pub fn from_api(api: &VntApi) -> NetworkOverview {
    NetworkOverview {
        info: Some(core_info(api)),
        devices: core_devices(api),
        routes: core_routes(api),
        stats: Some(core_chart(api)),
        error: None,
    }
}

fn core_info(api: &VntApi) -> CoreInfo {
    let config = api.get_config();
    let network = api.network();
    let nat_info = api.nat_info();
    let server = api
        .server_node_list()
        .into_iter()
        .find(|server| server.connected)
        .or_else(|| api.server_node_list().into_iter().next());

    CoreInfo {
        name: config
            .as_ref()
            .map(|config| config.device_name.clone())
            .unwrap_or_default(),
        virtual_ip: network
            .as_ref()
            .map(|network| network.ip.to_string())
            .unwrap_or_default(),
        virtual_gateway: network
            .as_ref()
            .map(|network| network.gateway.to_string())
            .unwrap_or_default(),
        virtual_netmask: network
            .as_ref()
            .map(|network| network.prefix_len.to_string())
            .unwrap_or_default(),
        connect_status: if network.is_some() {
            "connected".to_string()
        } else {
            "connecting".to_string()
        },
        relay_server: server
            .as_ref()
            .map(|server| server.server_addr.to_string())
            .unwrap_or_default(),
        nat_type: nat_info
            .as_ref()
            .map(|nat| format!("{:?}", nat.nat_type))
            .unwrap_or_default(),
        public_ips: nat_info
            .as_ref()
            .map(|nat| join_ipv4(&nat.public_ips))
            .unwrap_or_default(),
        local_addr: nat_info
            .as_ref()
            .map(|nat| nat.local_ipv4.to_string())
            .unwrap_or_default(),
        ipv6_addr: nat_info
            .as_ref()
            .and_then(|nat| nat.ipv6)
            .map(|ip| ip.to_string())
            .unwrap_or_default(),
    }
}

fn core_devices(api: &VntApi) -> Vec<CoreDevice> {
    let mut devices = api
        .client_ips()
        .into_iter()
        .map(|client| {
            let route = api.find_route(&client.ip);
            let nat = api.peer_nat_info(&client.ip);

            CoreDevice {
                virtual_ip: client.ip.to_string(),
                nat_type: nat
                    .as_ref()
                    .map(|nat| format!("{:?}", nat.nat_type))
                    .unwrap_or_default(),
                public_ips: nat
                    .as_ref()
                    .map(|nat| join_ipv4(&nat.public_ips))
                    .unwrap_or_default(),
                local_ip: nat
                    .as_ref()
                    .map(|nat| nat.local_ipv4.to_string())
                    .unwrap_or_default(),
                ipv6: nat
                    .as_ref()
                    .and_then(|nat| nat.ipv6)
                    .map(|ip| ip.to_string())
                    .unwrap_or_default(),
                nat_traversal_type: route
                    .as_ref()
                    .map(|route| {
                        if route.is_direct() {
                            "p2p"
                        } else {
                            "relay"
                        }
                        .to_string()
                    })
                    .unwrap_or_default(),
                rt: route
                    .as_ref()
                    .map(|route| route.rtt().to_string())
                    .unwrap_or_default(),
                status: if client.online || route.is_some() {
                    "online".to_string()
                } else {
                    "offline".to_string()
                },
                client_secret: false,
                current_client_secret: false,
                wire_guard: false,
                ..Default::default()
            }
        })
        .collect::<Vec<_>>();

    devices.sort_by(|left, right| left.virtual_ip.cmp(&right.virtual_ip));
    devices
}

fn core_routes(api: &VntApi) -> Vec<CoreRoute> {
    let mut routes = api
        .route_table()
        .into_iter()
        .flat_map(|(destination, route_list)| {
            route_list.into_iter().map(move |route| CoreRoute {
                destination: destination.to_string(),
                next_hop: route.route_key().to_string(),
                metric: route.metric().to_string(),
                rt: route.rtt().to_string(),
                interface: route.route_key().protocol().to_string(),
            })
        })
        .collect::<Vec<_>>();

    routes.sort_by(|left, right| {
        left.destination
            .cmp(&right.destination)
            .then(left.next_hop.cmp(&right.next_hop))
    });
    routes
}

fn core_chart(api: &VntApi) -> CoreChart {
    let mut up_total = 0;
    let mut down_total = 0;
    let mut up_map = HashMap::new();
    let mut down_map = HashMap::new();

    for traffic in api.all_traffic_info() {
        up_total += traffic.tx_bytes;
        down_total += traffic.rx_bytes;
        up_map.insert(traffic.ip.to_string(), traffic.tx_bytes);
        down_map.insert(traffic.ip.to_string(), traffic.rx_bytes);
    }

    CoreChart {
        disable_stats: false,
        up_total,
        down_total,
        up_map,
        down_map,
    }
}

fn join_ipv4(values: &[Ipv4Addr]) -> String {
    values
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

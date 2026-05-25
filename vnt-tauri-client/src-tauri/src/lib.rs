mod embedded;

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::Ipv4Addr,
    path::PathBuf,
    sync::{Arc, Mutex},
};
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};
use tauri::{AppHandle, Manager, State};

const LOG_LIMIT: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConfig {
    pub item_key: String,
    pub config_name: String,
    pub token: String,
    pub device_name: String,
    pub virtual_ipv4: String,
    pub server_address: String,
    pub stun_servers: Vec<String>,
    pub in_ips: Vec<String>,
    pub out_ips: Vec<String>,
    pub port_mappings: Vec<String>,
    pub group_password: String,
    pub is_server_encrypted: bool,
    pub protocol: String,
    pub data_fingerprint_verification: bool,
    pub encryption_algorithm: String,
    pub device_id: String,
    pub virtual_network_card_name: String,
    pub mtu: u32,
    pub ports: Vec<u16>,
    pub first_latency: bool,
    pub no_in_ip_proxy: bool,
    pub dns: Vec<String>,
    pub simulated_packet_loss_rate: f64,
    pub simulated_latency: u32,
    pub punch_model: String,
    pub use_channel_type: String,
    pub compressor: String,
    pub core_mode: String,
    pub local_dev: String,
    pub disable_stats: bool,
    pub allow_wg: bool,
    pub vnt_mappings: Vec<String>,
    #[serde(default)]
    pub no_tun: bool,
    #[serde(default)]
    pub rtx: bool,
    #[serde(default)]
    pub fec: bool,
    #[serde(default)]
    pub no_punch: bool,
    #[serde(default)]
    pub allow_port_mapping: bool,
    #[serde(default)]
    pub tunnel_port: Option<u16>,
    #[serde(default)]
    pub cert_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub auto_connect_item_key: String,
    pub auto_start: bool,
    pub close_to_tray: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            auto_connect_item_key: String::new(),
            auto_start: false,
            close_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredData {
    configs: Vec<NetworkConfig>,
    preferences: Preferences,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub configs: Vec<NetworkConfig>,
    pub preferences: Preferences,
    pub connections: Vec<ConnectionView>,
    pub app_logs: Vec<String>,
    pub core_available: bool,
    pub core_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    pub item_key: String,
    pub config_name: String,
    pub core_mode: String,
    pub status: String,
    pub temporary_exit_ip: Option<String>,
    pub temporary_exit_name: Option<String>,
    pub pid: Option<u32>,
    pub started_at: String,
    pub command_preview: Vec<String>,
    pub logs: Vec<String>,
    pub last_error: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreview {
    pub executable: String,
    pub args: Vec<String>,
    pub display: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOverview {
    pub info: Option<CoreInfo>,
    pub devices: Vec<CoreDevice>,
    pub routes: Vec<CoreRoute>,
    pub stats: Option<CoreChart>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct CoreInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub virtual_ip: String,
    #[serde(default)]
    pub virtual_gateway: String,
    #[serde(default)]
    pub virtual_netmask: String,
    #[serde(default)]
    pub connect_status: String,
    #[serde(default)]
    pub relay_server: String,
    #[serde(default)]
    pub nat_type: String,
    #[serde(default)]
    pub public_ips: String,
    #[serde(default)]
    pub local_addr: String,
    #[serde(default)]
    pub ipv6_addr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct CoreDevice {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub virtual_ip: String,
    #[serde(default)]
    pub nat_type: String,
    #[serde(default)]
    pub public_ips: String,
    #[serde(default)]
    pub local_ip: String,
    #[serde(default)]
    pub ipv6: String,
    #[serde(default)]
    pub nat_traversal_type: String,
    #[serde(default)]
    pub rt: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub client_secret: bool,
    #[serde(default)]
    pub current_client_secret: bool,
    #[serde(default)]
    pub wire_guard: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct CoreRoute {
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub next_hop: String,
    #[serde(default)]
    pub metric: String,
    #[serde(default)]
    pub rt: String,
    #[serde(default)]
    pub interface: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct CoreChart {
    #[serde(default)]
    pub disable_stats: bool,
    #[serde(default)]
    pub up_total: u64,
    #[serde(default)]
    pub down_total: u64,
    #[serde(default)]
    pub up_map: HashMap<String, u64>,
    #[serde(default)]
    pub down_map: HashMap<String, u64>,
}

#[derive(Default)]
pub struct AppRuntime {
    connections: Mutex<HashMap<String, ManagedConnection>>,
    app_logs: Arc<Mutex<Vec<String>>>,
    core_version: Mutex<Option<String>>,
    #[cfg(desktop)]
    exiting: Mutex<bool>,
}

pub enum ManagedConnection {
    Embedded(embedded::manager::EmbeddedConnection),
}

fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;
    Ok(dir.join("vnt-state.json"))
}

#[cfg(windows)]
fn runtime_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?
        .join("runtime");
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建运行时目录: {error}"))?;
    Ok(dir)
}

fn load_storage(app: &AppHandle) -> Result<StoredData, String> {
    let path = storage_path(app)?;
    if !path.exists() {
        return Ok(StoredData::default());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("无法读取配置: {error}"))?;
    if content.trim().is_empty() {
        return Ok(StoredData::default());
    }
    serde_json::from_str(&content)
        .map(normalize_stored_data)
        .map_err(|error| format!("配置文件格式错误: {error}"))
}

fn save_storage(app: &AppHandle, data: &StoredData) -> Result<(), String> {
    let path = storage_path(app)?;
    let data = normalize_stored_data(data.clone());
    let content =
        serde_json::to_string_pretty(&data).map_err(|error| format!("无法序列化配置: {error}"))?;
    fs::write(path, content).map_err(|error| format!("无法写入配置: {error}"))
}

fn normalize_stored_data(mut data: StoredData) -> StoredData {
    for config in &mut data.configs {
        force_tun_config(config);
    }
    data
}

fn force_tun_config(config: &mut NetworkConfig) {
    config.core_mode = "tun".to_string();
}

fn apply_platform_startup_limits(config: &mut NetworkConfig) {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        config.no_tun = true;
        config.no_punch = true;
        config.no_in_ip_proxy = true;
        config.allow_port_mapping = false;
        config.in_ips.clear();
        config.out_ips.clear();
        config.port_mappings.clear();
        config.use_channel_type = "relay".to_string();
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = config;
    }
}

fn snapshot(app: &AppHandle, runtime: &AppRuntime) -> Result<AppSnapshot, String> {
    let data = load_storage(app)?;
    let mut connections = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?;

    let views = connections
        .values_mut()
        .map(connection_view)
        .collect::<Vec<_>>();

    Ok(AppSnapshot {
        configs: data.configs,
        preferences: data.preferences,
        connections: views,
        app_logs: runtime
            .app_logs
            .lock()
            .map(|logs| logs.clone())
            .unwrap_or_default(),
        core_available: core_available(app),
        core_version: core_version(app, runtime),
    })
}

fn core_version(_app: &AppHandle, runtime: &AppRuntime) -> String {
    if let Ok(cache) = runtime.core_version.lock() {
        if let Some(version) = cache.as_ref() {
            return version.clone();
        }
    }

    let version = detect_core_version();
    if let Ok(mut cache) = runtime.core_version.lock() {
        *cache = Some(version.clone());
    }
    version
}

fn detect_core_version() -> String {
    embedded::core_version().to_string()
}

#[cfg(test)]
mod embedded_compile_tests {
    #[test]
    fn embedded_module_is_linked() {
        assert_eq!(crate::embedded::core_version(), "2.0.0");
    }
}

fn core_available(_app: &AppHandle) -> bool {
    true
}

fn connection_view(connection: &mut ManagedConnection) -> ConnectionView {
    match connection {
        ManagedConnection::Embedded(connection) => connection.view(),
    }
}

fn validate_config(config: &NetworkConfig) -> Result<(), String> {
    if config.token.trim().is_empty() {
        return Err("组网编号不能为空".to_string());
    }
    if config.device_name.trim().is_empty() {
        return Err("设备名称不能为空".to_string());
    }
    if config.server_address.trim().is_empty() {
        return Err("服务器地址不能为空".to_string());
    }
    if !(0.0..=1.0).contains(&config.simulated_packet_loss_rate) {
        return Err("模拟丢包率必须在 0 到 1 之间".to_string());
    }
    Ok(())
}

fn temporary_exit_in_ip(device_ip: &str) -> Result<String, String> {
    let ip = device_ip.trim();
    if ip.is_empty() {
        return Err("出口设备 IP 不能为空".to_string());
    }
    ip.parse::<Ipv4Addr>()
        .map_err(|_| "出口设备 IP 必须是有效的虚拟 IPv4".to_string())?;
    Ok(format!("0.0.0.0/0,{ip}"))
}

#[cfg(target_os = "android")]
fn init_android_logger() {
    let _ = android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Info)
            .with_tag("VNTMesh"),
    );
}

#[cfg(target_os = "android")]
static ANDROID_CONTEXT_REF: std::sync::OnceLock<jni::objects::GlobalRef> =
    std::sync::OnceLock::new();

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_wherewego_vnt_android_AndroidNative_initializeAndroidContext(
    mut env: jni::JNIEnv<'_>,
    _class: jni::objects::JClass<'_>,
    activity: jni::objects::JObject<'_>,
) {
    init_android_logger();
    if ANDROID_CONTEXT_REF.get().is_some() {
        log::info!("Android context already initialized");
        return;
    }

    let vm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(error) => {
            log::error!("Failed to get Android JavaVM: {error}");
            return;
        }
    };
    let global_context = match env
        .call_method(
            &activity,
            "getApplicationContext",
            "()Landroid/content/Context;",
            &[],
        )
        .and_then(|value| value.l())
    {
        Ok(context) if !context.as_raw().is_null() => env.new_global_ref(&context),
        _ => env.new_global_ref(&activity),
    };
    let global_context = match global_context {
        Ok(context) => context,
        Err(error) => {
            log::error!("Failed to create Android context global ref: {error}");
            return;
        }
    };

    let java_vm = vm.get_java_vm_pointer().cast::<std::ffi::c_void>();
    let context = global_context.as_obj().as_raw().cast::<std::ffi::c_void>();
    if ANDROID_CONTEXT_REF.set(global_context).is_ok() {
        unsafe {
            ndk_context::initialize_android_context(java_vm, context);
        }
        log::info!("Android context initialized for VNT core");
    }
}

#[cfg(target_os = "android")]
fn call_android_system_bars(_theme: &str, _modal_open: bool) -> Result<(), String> {
    Ok(())
}

fn push_log(logs: &Arc<Mutex<Vec<String>>>, line: String) {
    if let Ok(mut guard) = logs.lock() {
        guard.push(line);
        let overflow = guard.len().saturating_sub(LOG_LIMIT);
        if overflow > 0 {
            guard.drain(0..overflow);
        }
    }
}

fn push_runtime_log(runtime: &AppRuntime, line: impl Into<String>) {
    push_log(&runtime.app_logs, format!("[app] {}", line.into()));
}

fn terminate_connection(connection: ManagedConnection) {
    match connection {
        ManagedConnection::Embedded(connection) => connection.stop(),
    }
}

fn terminate_all_connections(_app: &AppHandle, runtime: &AppRuntime) {
    let connections_to_stop = runtime
        .connections
        .lock()
        .map(|mut connections| {
            connections
                .drain()
                .map(|(_, connection)| connection)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for connection in connections_to_stop {
        terminate_connection(connection);
    }
}

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg(desktop)]
fn close_to_tray_enabled(app: &AppHandle) -> bool {
    load_storage(app)
        .map(|data| data.preferences.close_to_tray)
        .unwrap_or_else(|_| Preferences::default().close_to_tray)
}

#[cfg(desktop)]
fn is_app_exiting(runtime: &AppRuntime) -> bool {
    runtime
        .exiting
        .lock()
        .map(|exiting| *exiting)
        .unwrap_or(true)
}

#[cfg(desktop)]
fn request_app_exit(app: &AppHandle) {
    let runtime = app.state::<AppRuntime>();
    if let Ok(mut exiting) = runtime.exiting.lock() {
        *exiting = true;
    }
    app.exit(0);
}

#[cfg(desktop)]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("VNT MESH")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => request_app_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn auto_connect_saved_config(app: &AppHandle) {
    let Ok(data) = load_storage(app) else {
        return;
    };
    let item_key = data.preferences.auto_connect_item_key.trim();
    if item_key.is_empty()
        || !data
            .configs
            .iter()
            .any(|config| config.item_key == item_key)
    {
        return;
    }

    let runtime = app.state::<AppRuntime>();
    let _ = connect_config_inner(app, runtime.inner(), item_key);
}

#[tauri::command]
fn load_app_state(app: AppHandle, runtime: State<'_, AppRuntime>) -> Result<AppSnapshot, String> {
    snapshot(&app, &runtime)
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    mut config: NetworkConfig,
) -> Result<AppSnapshot, String> {
    force_tun_config(&mut config);
    validate_config(&config)?;
    if config.item_key.trim().is_empty() {
        config.item_key = uuid::Uuid::new_v4().to_string();
    }
    if config.config_name.trim().is_empty() {
        config.config_name = if config.token.len() > 6 {
            config.token.chars().take(6).collect()
        } else {
            config.token.clone()
        };
    }

    let mut data = load_storage(&app)?;
    if let Some(existing) = data
        .configs
        .iter_mut()
        .find(|existing| existing.item_key == config.item_key)
    {
        *existing = config;
    } else {
        data.configs.push(config);
    }
    save_storage(&app, &data)?;
    snapshot(&app, &runtime)
}

#[tauri::command]
fn delete_config(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    item_key: String,
) -> Result<AppSnapshot, String> {
    let is_connected = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?
        .contains_key(&item_key);
    if is_connected {
        return Err("已连接的配置不能删除，请先断开连接".to_string());
    }

    let mut data = load_storage(&app)?;
    data.configs.retain(|config| config.item_key != item_key);
    if data.preferences.auto_connect_item_key == item_key {
        data.preferences.auto_connect_item_key.clear();
    }
    save_storage(&app, &data)?;
    snapshot(&app, &runtime)
}

#[tauri::command]
fn connect_config(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    item_key: String,
) -> Result<AppSnapshot, String> {
    connect_config_inner(&app, &runtime, &item_key)
}

fn connect_config_inner(
    app: &AppHandle,
    runtime: &AppRuntime,
    item_key: &str,
) -> Result<AppSnapshot, String> {
    push_runtime_log(runtime, format!("请求启动配置 {item_key}"));
    start_config_inner(app, runtime, item_key, None)
}

fn start_config_inner(
    app: &AppHandle,
    runtime: &AppRuntime,
    item_key: &str,
    temporary_exit: Option<(String, String)>,
) -> Result<AppSnapshot, String> {
    let (already_running, stale_connections) = prepare_connections_for_start(runtime, item_key)?;
    if !stale_connections.is_empty() {
        push_runtime_log(runtime, "启动配置前清理已有连接");
    }
    for connection in stale_connections {
        terminate_connection(connection);
    }
    if already_running {
        return snapshot(app, runtime);
    }

    let data = load_storage(app)?;
    let mut config = data
        .configs
        .iter()
        .find(|config| config.item_key == item_key)
        .cloned()
        .ok_or_else(|| "未找到要连接的配置".to_string())?;
    force_tun_config(&mut config);
    apply_platform_startup_limits(&mut config);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    push_runtime_log(runtime, "移动端使用无 TUN/无 P2P 沙盒兼容模式");
    validate_config(&config)?;
    push_runtime_log(
        runtime,
        format!(
            "配置已校验：{}，服务器 {}，协议 {}",
            config.config_name, config.server_address, config.protocol
        ),
    );

    start_embedded_config_inner(app, runtime, config, temporary_exit)
}

fn prepare_connections_for_start(
    runtime: &AppRuntime,
    item_key: &str,
) -> Result<(bool, Vec<ManagedConnection>), String> {
    let mut connections = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?;
    if connections.contains_key(item_key) {
        return Ok((true, Vec::new()));
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let stale_connections = connections
            .drain()
            .map(|(_, connection)| connection)
            .collect::<Vec<_>>();
        Ok((false, stale_connections))
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        connections.remove(item_key);
        Ok((false, Vec::new()))
    }
}

fn start_embedded_config_inner(
    app: &AppHandle,
    runtime: &AppRuntime,
    config: NetworkConfig,
    temporary_exit: Option<(String, String)>,
) -> Result<AppSnapshot, String> {
    #[cfg(target_os = "android")]
    init_android_logger();
    #[cfg(windows)]
    {
        let dir = runtime_data_dir(app)?;
        embedded::wintun::ensure_wintun_dll(&dir)
            .map_err(|error| format!("准备 wintun.dll 失败: {error}"))?;
        push_runtime_log(runtime, format!("已准备 wintun.dll：{}", dir.display()));
    }

    let item_key = config.item_key.clone();
    let connection = embedded::manager::EmbeddedConnection::start(config, temporary_exit)
        .map_err(|error| format!("启动 embedded VNT 内核失败: {error:#}"))?;
    runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?
        .insert(item_key, ManagedConnection::Embedded(connection));

    snapshot(app, runtime)
}

#[tauri::command]
fn set_temporary_exit(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    item_key: String,
    device_ip: Option<String>,
    device_name: Option<String>,
) -> Result<AppSnapshot, String> {
    let temporary_exit = device_ip
        .map(|ip| {
            let clean_ip = ip.trim().to_string();
            temporary_exit_in_ip(&clean_ip)?;
            let clean_name = device_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(&clean_ip)
                .to_string();
            Ok::<_, String>((clean_ip, clean_name))
        })
        .transpose()?;

    let connection = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?
        .remove(&item_key);
    if let Some(connection) = connection {
        terminate_connection(connection);
    }

    start_config_inner(&app, &runtime, &item_key, temporary_exit)
}

#[tauri::command]
fn disconnect_config(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    item_key: String,
) -> Result<AppSnapshot, String> {
    let connection = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?
        .remove(&item_key);
    if let Some(connection) = connection {
        terminate_connection(connection);
    }
    snapshot(&app, &runtime)
}

#[tauri::command]
fn disconnect_all(app: AppHandle, runtime: State<'_, AppRuntime>) -> Result<AppSnapshot, String> {
    terminate_all_connections(&app, &runtime);
    snapshot(&app, &runtime)
}

#[tauri::command]
fn save_preferences(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    preferences: Preferences,
) -> Result<AppSnapshot, String> {
    let mut data = load_storage(&app)?;
    if data.preferences.auto_start != preferences.auto_start {
        configure_autostart(&app, preferences.auto_start)?;
    }
    data.preferences = preferences;
    save_storage(&app, &data)?;
    snapshot(&app, &runtime)
}

#[tauri::command]
fn clear_app_data(app: AppHandle, runtime: State<'_, AppRuntime>) -> Result<AppSnapshot, String> {
    let connections_to_stop = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?
        .drain()
        .map(|(_, connection)| connection)
        .collect::<Vec<_>>();
    for connection in connections_to_stop {
        terminate_connection(connection);
    }

    let path = storage_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("删除应用数据失败: {error}"))?;
    }
    configure_autostart(&app, false)?;
    snapshot(&app, &runtime)
}

#[tauri::command]
fn get_command_preview(_app: AppHandle, config: NetworkConfig) -> Result<CommandPreview, String> {
    let mut config = config;
    force_tun_config(&mut config);
    validate_config(&config)?;
    Ok(embedded::preview::command_preview(&config))
}

#[tauri::command]
fn export_config(app: AppHandle, item_key: String) -> Result<String, String> {
    let data = load_storage(&app)?;
    let config = data
        .configs
        .iter()
        .find(|config| config.item_key == item_key)
        .ok_or_else(|| "未找到配置".to_string())?;
    serde_json::to_string_pretty(config).map_err(|error| format!("导出配置失败: {error}"))
}

#[tauri::command]
fn run_core_query(
    _app: AppHandle,
    _core_mode: String,
    query: String,
    chart_ip: Option<String>,
) -> Result<String, String> {
    let chart_ip = chart_ip
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("-");
    Ok(format!(
        "$ embedded-vnt-core --query {query}\n\n嵌入式内核不再提供外部 CLI 查询端口；请使用网络概览面板查看状态。\nchart_ip: {chart_ip}"
    ))
}

#[tauri::command]
fn get_network_overview(
    _app: AppHandle,
    runtime: State<'_, AppRuntime>,
    _core_mode: String,
    item_key: Option<String>,
) -> Result<NetworkOverview, String> {
    let connections = runtime
        .connections
        .lock()
        .map_err(|_| "连接状态锁已损坏".to_string())?;
    let connection = if let Some(item_key) = item_key {
        connections.get(&item_key)
    } else {
        connections.values().next()
    };
    let Some(ManagedConnection::Embedded(connection)) = connection else {
        return Ok(NetworkOverview::default());
    };
    let Some(api) = connection.api() else {
        return Ok(NetworkOverview {
            error: Some("embedded VNT API is not available".to_string()),
            ..Default::default()
        });
    };

    Ok(embedded::overview::from_api(&api))
}

#[tauri::command]
fn set_android_system_bars(theme: String, modal_open: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return call_android_system_bars(&theme, modal_open);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (theme, modal_open);
        Ok(())
    }
}

#[cfg(windows)]
fn configure_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use std::process::Command;

    let task_name = "VNTCoreDesktopStartup";
    let exe = std::env::current_exe().map_err(|error| format!("无法获取程序路径: {error}"))?;
    let output = if enabled {
        let username = std::env::var("USERNAME").unwrap_or_else(|_| "SYSTEM".to_string());
        let exe_arg = exe.to_string_lossy().to_string();
        Command::new("SCHTASKS.EXE")
            .args([
                "/CREATE",
                "/F",
                "/TN",
                task_name,
                "/TR",
                exe_arg.as_str(),
                "/SC",
                "ONLOGON",
                "/RL",
                "HIGHEST",
                "/IT",
                "/RU",
                username.as_str(),
            ])
            .output()
    } else {
        Command::new("SCHTASKS.EXE")
            .args(["/DELETE", "/TN", task_name, "/F"])
            .output()
    };

    match output {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) if !enabled => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("ERROR: The system cannot find the file specified") {
                Ok(())
            } else {
                Err(format!("更新开机启动失败: {stderr}"))
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("更新开机启动失败: {stderr}"))
        }
        Err(error) => Err(format!("调用计划任务失败: {error}")),
    }?;

    let _ = app;
    Ok(())
}

#[cfg(not(windows))]
fn configure_autostart(_app: &AppHandle, _enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(AppRuntime::default())
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_config,
            delete_config,
            connect_config,
            set_temporary_exit,
            disconnect_config,
            disconnect_all,
            save_preferences,
            clear_app_data,
            get_command_preview,
            export_config,
            run_core_query,
            get_network_overview,
            set_android_system_bars,
        ]);

    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        setup_tray(app.handle())?;
        auto_connect_saved_config(app.handle());
        Ok(())
    });

    #[cfg(mobile)]
    let builder = builder.setup(|app| {
        auto_connect_saved_config(app.handle());
        Ok(())
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building VNT Tauri application")
        .run(|app_handle, event| {
            #[cfg(desktop)]
            {
                let runtime = app_handle.state::<AppRuntime>();
                match event {
                    tauri::RunEvent::WindowEvent {
                        label,
                        event: tauri::WindowEvent::CloseRequested { api, .. },
                        ..
                    } if label == "main" && !is_app_exiting(&runtime) => {
                        if close_to_tray_enabled(app_handle) {
                            api.prevent_close();
                            hide_main_window(app_handle);
                        } else {
                            api.prevent_close();
                            request_app_exit(app_handle);
                        }
                    }
                    tauri::RunEvent::ExitRequested { .. } => {
                        terminate_all_connections(app_handle, &runtime);
                    }
                    _ => {}
                }
            }
            #[cfg(mobile)]
            {
                if let tauri::RunEvent::ExitRequested { .. } = event {
                    let runtime = app_handle.state::<AppRuntime>();
                    terminate_all_connections(app_handle, &runtime);
                }
            }
        });
}

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

#[cfg(target_os = "ios")]
mod native {
    use super::IosVpnProfile;
    use anyhow::{anyhow, Context};
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int, c_void};

    unsafe extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    const RTLD_DEFAULT: *mut c_void = (-2isize) as *mut c_void;

    type StartFn = unsafe extern "C" fn(*const c_char) -> c_int;
    type StopFn = unsafe extern "C" fn() -> c_int;
    type LastErrorFn = unsafe extern "C" fn() -> *const c_char;

    pub fn start(profile: &IosVpnProfile) -> anyhow::Result<()> {
        let json = serde_json::to_string(profile).context("serialize iOS VPN profile")?;
        let json = CString::new(json).context("iOS VPN profile contains NUL byte")?;
        let start = unsafe { resolve::<StartFn>("vnt_ios_vpn_start")? };
        let result = unsafe { start(json.as_ptr()) };
        if result == 0 {
            Ok(())
        } else {
            Err(anyhow!(last_error()))
        }
    }

    pub fn stop() -> anyhow::Result<()> {
        let stop = unsafe { resolve::<StopFn>("vnt_ios_vpn_stop")? };
        let result = unsafe { stop() };
        if result == 0 {
            Ok(())
        } else {
            Err(anyhow!(last_error()))
        }
    }

    fn last_error() -> String {
        let last_error = match unsafe { resolve::<LastErrorFn>("vnt_ios_vpn_last_error") } {
            Ok(last_error) => last_error,
            Err(error) => return error.to_string(),
        };
        let raw = unsafe { last_error() };
        if raw.is_null() {
            return "iOS VPN native bridge failed".to_string();
        }
        unsafe { CStr::from_ptr(raw) }
            .to_string_lossy()
            .trim()
            .to_string()
    }

    unsafe fn resolve<T>(symbol: &str) -> anyhow::Result<T>
    where
        T: Copy,
    {
        let symbol = CString::new(symbol).context("iOS VPN bridge symbol contains NUL byte")?;
        let ptr = dlsym(RTLD_DEFAULT, symbol.as_ptr());
        if ptr.is_null() {
            anyhow::bail!("iOS VPN native bridge symbol not found: {}", symbol.to_string_lossy());
        }
        Ok(std::mem::transmute_copy(&ptr))
    }
}

#[cfg(not(target_os = "ios"))]
mod native {
    use super::IosVpnProfile;

    pub fn start(_profile: &IosVpnProfile) -> anyhow::Result<()> {
        anyhow::bail!("iOS VPN bridge is only available on iOS")
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

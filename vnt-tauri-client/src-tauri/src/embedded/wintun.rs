#[cfg(all(windows, target_arch = "x86_64"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/amd64/wintun.dll");

#[cfg(all(windows, target_arch = "x86"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/x86/wintun.dll");

#[cfg(all(windows, target_arch = "aarch64"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/arm64/wintun.dll");

#[cfg(all(windows, target_arch = "arm"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/arm/wintun.dll");

#[cfg(windows)]
pub fn ensure_wintun_dll() -> std::io::Result<()> {
    use std::{fs, io::Write, path::Path};

    let path = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.join("wintun.dll")))
        .unwrap_or_else(|| Path::new("wintun.dll").to_path_buf());

    if path.exists() {
        return Ok(());
    }

    let mut file = fs::File::create(&path)?;
    file.write_all(WINTUN_DLL)?;
    Ok(())
}

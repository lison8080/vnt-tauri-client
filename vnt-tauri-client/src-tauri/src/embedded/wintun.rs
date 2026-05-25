#[cfg(all(windows, target_arch = "x86_64"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/amd64/wintun.dll");

#[cfg(all(windows, target_arch = "x86"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/x86/wintun.dll");

#[cfg(all(windows, target_arch = "aarch64"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/arm64/wintun.dll");

#[cfg(all(windows, target_arch = "arm"))]
const WINTUN_DLL: &[u8] = include_bytes!("../../../../vnt/dll/arm/wintun.dll");

#[cfg(windows)]
pub fn ensure_wintun_dll(dir: &std::path::Path) -> std::io::Result<()> {
    use std::{fs, io::Write};

    fs::create_dir_all(dir)?;
    let path = dir.join("wintun.dll");

    if !path.exists() {
        let mut file = fs::File::create(&path)?;
        file.write_all(WINTUN_DLL)?;
    }

    add_dll_search_dir(dir)?;
    load_wintun_dll(&path)
}

#[cfg(windows)]
fn add_dll_search_dir(dir: &std::path::Path) -> std::io::Result<()> {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
    }

    let wide = wide_path(dir);
    let ok = unsafe { SetDllDirectoryW(wide.as_ptr()) };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn load_wintun_dll(path: &std::path::Path) -> std::io::Result<()> {
    use std::ffi::c_void;

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryW(lpLibFileName: *const u16) -> *mut c_void;
    }

    let wide = wide_path(path);
    let handle = unsafe { LoadLibraryW(wide.as_ptr()) };
    if handle.is_null() {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn wide_path(path: &std::path::Path) -> Vec<u16> {
    use std::{iter::once, os::windows::ffi::OsStrExt};

    path.as_os_str().encode_wide().chain(once(0)).collect()
}

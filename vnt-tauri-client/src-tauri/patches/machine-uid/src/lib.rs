use std::io;

#[cfg(target_os = "linux")]
use std::fs;

pub fn get() -> io::Result<String> {
    platform_id()
        .map(normalize)
        .and_then(non_empty)
        .or_else(|_| env_id())
}

#[cfg(target_os = "linux")]
fn platform_id() -> io::Result<String> {
    fs::read_to_string("/etc/machine-id")
        .or_else(|_| fs::read_to_string("/var/lib/dbus/machine-id"))
}

#[cfg(target_os = "windows")]
fn platform_id() -> io::Result<String> {
    std::env::var("COMPUTERNAME").map_err(io::Error::other)
}

#[cfg(target_os = "macos")]
fn platform_id() -> io::Result<String> {
    std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .and_then(|output| {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).into_owned())
            } else {
                Err(io::Error::other("ioreg failed"))
            }
        })
        .and_then(|output| {
            output
                .lines()
                .find_map(|line| {
                    line.split_once("IOPlatformUUID").and_then(|(_, value)| {
                        value
                            .split('"')
                            .nth(1)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToOwned::to_owned)
                    })
                })
                .ok_or_else(|| io::Error::other("IOPlatformUUID not found"))
        })
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn platform_id() -> io::Result<String> {
    Err(io::Error::other("machine id is unsupported on this target"))
}

fn env_id() -> io::Result<String> {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .map(normalize)
        .map_err(io::Error::other)
        .and_then(non_empty)
}

fn normalize(value: String) -> String {
    value.trim().to_string()
}

fn non_empty(value: String) -> io::Result<String> {
    if value.is_empty() {
        Err(io::Error::other("machine id is empty"))
    } else {
        Ok(value)
    }
}

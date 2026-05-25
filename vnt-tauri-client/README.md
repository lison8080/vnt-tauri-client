# VNT Tauri Client

This Tauri 2 client embeds the local VNT 2 Rust core from `../vnt/vnt-core`.
It does not require prebuilt `vnt-cli` or `vn-link-cli` sidecar binaries.

## What Is Included

- React + Tailwind frontend.
- Tauri Rust backend that manages `vnt-core` in process.
- Client configuration, startup settings, tray integration, embedded status,
  device overview, logs, and route/status views.
- GitHub Actions workflow for Windows/Linux/macOS desktop bundles, Android APKs,
  an unsigned iOS IPA, and an iOS Rust library build check.

## Repository Layout

Keep the client and core as siblings:

```text
vnt/
  vnt/                 # latest VNT 2 core workspace
    vnt-core/
    dll/               # Windows wintun.dll assets embedded at compile time
  vnt-tauri-client/    # Tauri app
```

The app links `../../vnt/vnt-core` from `src-tauri/Cargo.toml`, so CI and local
builds need the same sibling layout or an equivalent checked-in monorepo layout.

## Development

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run lint
npm run build
npm run tauri:build
```

Runtime notes:

- Windows embeds the matching `wintun.dll` from `../vnt/dll` and writes it next
  to the app executable before starting the embedded core.
- Linux TUN mode needs permission to create/configure a TUN interface and
  routes.
- Android and iOS currently build the embedded Rust core path, but full mobile
  system VPN/TUN mode still needs the native bridge:
  - Android has a Kotlin `VpnService` scaffold; Rust still needs to call it and
    pass the returned fd into `NetworkManager::start_tun_fd`.
  - iOS needs a `NetworkExtension` / `NEPacketTunnelProvider` packet-flow bridge.
  - Until those bridges are finished, mobile `noTun` mode is the only embedded
    mode that can avoid the TUN startup error.

CI note: iOS packaging runs on the macOS GitHub Actions runner. The workflow
generates the Tauri iOS project, builds an unsigned iPhoneOS `.app` bundle with
Xcode signing disabled, and packages it as `vnt-tauri-ios-unsigned.ipa`. This IPA
is meant for later signing/re-signing; installing on physical devices still
requires a valid Apple signing identity and provisioning profile.

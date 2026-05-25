# VNT Tauri Client

This repository combines the VNT core source and the Tauri client in one build workspace.

## Layout

- `vnt/`: VNT core source.
- `vnt-tauri-client/`: Tauri desktop/mobile client.

The app depends on the core through a local Cargo path:

```toml
vnt-core = { path = "../../vnt/vnt-core" }
```

No prebuilt VNT core executable is required.

## Clone

```bash
git clone <repo-url>
cd vnt
```

## Build locally

```bash
cd vnt-tauri-client
npm ci
npm run lint
npm run tauri -- build
```

## GitHub Actions

`.github/workflows/build.yml` builds artifacts for:

- Linux
- Windows
- macOS universal
- Android APK
- iOS Rust static library

The workflow compiles the app against the in-repository `vnt/vnt-core` source.

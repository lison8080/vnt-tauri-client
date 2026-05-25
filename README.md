# VNT Tauri Client

This repository combines the VNT core source and the Tauri client in one build workspace.

## Layout

- `vnt/`: VNT core source, tracked as a Git submodule.
- `vnt-tauri-client/`: Tauri desktop/mobile client.

The app depends on the core through a local Cargo path:

```toml
vnt-core = { path = "../../vnt/vnt-core" }
```

No prebuilt VNT core executable is required.

## Clone

```bash
git clone --recurse-submodules <repo-url>
cd vnt
```

If the repository was cloned without submodules:

```bash
git submodule update --init --recursive
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

The workflow checks out submodules recursively so the app can compile against `vnt/vnt-core`.

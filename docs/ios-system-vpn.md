# iOS System VPN Integration

## Current state

The iOS unsigned IPA can be built by GitHub Actions, but it cannot create a raw
ICMP socket or a normal TUN interface from the main Tauri app sandbox. Current
mobile startup therefore uses sandbox-safe limits until the system VPN path is
implemented.

## Required architecture

iOS does not expose a reusable TUN file descriptor to the main app. A real
system VPN must run through a `NetworkExtension` `PacketTunnelProvider`.

That means the VNT packet path has to run inside the packet tunnel extension or
through an explicit packet bridge:

1. The main Tauri app stores the VNT profile and starts/stops the VPN manager.
2. `PacketTunnelProvider` receives packets from `NEPacketTunnelFlow`.
3. VNT core processes outbound packets from the packet flow.
4. VNT core sends inbound packets back to `NEPacketTunnelFlow`.
5. The extension owns network settings, routes, DNS, MTU, and lifecycle.

Android is different: `VpnService.Builder.establish()` returns a file
descriptor that can be handed to the Rust core. The VNT core now supports this
mobile fd path so Android can be wired without changing the packet IO model.

## Release policy

Every code change should be released by bumping the next patch tag with:

```bash
node scripts/release-next.mjs
git push origin main --tags
```

The tag push triggers GitHub Actions and publishes the generated installers and
mobile packages to GitHub Releases.

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const genApple = path.join(root, 'src-tauri', 'gen', 'apple');
const iosSource = path.join(root, 'src-tauri', 'ios');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findFile(dir, name) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) {
        return found;
      }
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function copyBridgeSources() {
  const appSwiftDir = findFile(genApple, 'Info.plist');
  if (!appSwiftDir) {
    fail('Unable to locate generated iOS Info.plist');
  }
  const appDir = path.dirname(appSwiftDir);
  const targetDir = path.join(appDir, 'VntIosVpn');
  fs.mkdirSync(targetDir, { recursive: true });

  fs.copyFileSync(path.join(iosSource, 'VntIosVpnBridge.swift'), path.join(targetDir, 'VntIosVpnBridge.swift'));
  fs.copyFileSync(path.join(iosSource, 'PacketTunnelProvider.swift'), path.join(targetDir, 'PacketTunnelProvider.swift.template'));

  const extensionInfo = path.join(targetDir, 'PacketTunnelInfo.plist');
  if (!fs.existsSync(extensionInfo)) {
    fs.writeFileSync(extensionInfo, packetTunnelInfoPlist(), 'utf8');
  }
  return { appDir, targetDir };
}

function packetTunnelInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>VNT Packet Tunnel</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.networkextension.packet-tunnel</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).PacketTunnelProvider</string>
  </dict>
</dict>
</plist>
`;
}

function patchProject() {
  const projectFile = findFile(genApple, 'project.pbxproj');
  if (!projectFile) {
    fail('Unable to locate project.pbxproj');
  }

  const pbx = fs.readFileSync(projectFile, 'utf8');
  if (!pbx.includes('PRODUCT_BUNDLE_IDENTIFIER')) {
    fail('Generated iOS project does not look like an Xcode project');
  }
}

copyBridgeSources();
patchProject();
console.log('iOS VPN bridge sources patched into generated Xcode project');

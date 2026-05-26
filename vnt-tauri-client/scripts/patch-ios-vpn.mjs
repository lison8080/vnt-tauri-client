#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcTauri = path.join(root, 'src-tauri');
const genApple = path.join(srcTauri, 'gen', 'apple');

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function writeIfChanged(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) {
    return;
  }
  fs.writeFileSync(file, contents, 'utf8');
  console.log(`Wrote ${path.relative(root, file)}`);
}

function plist(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
}

function networkExtensionEntitlements() {
  return plist(`  <key>com.apple.developer.networking.networkextension</key>
  <array>
    <string>packet-tunnel-provider</string>
  </array>
`);
}

function appInfoPlist({ productName, identifier, version }) {
  return plist(`  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${xml(productName)}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>${xml(identifier)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>${xml(version)}</string>
  <key>CFBundleVersion</key>
  <string>${xml(version)}</string>
  <key>LSRequiresIPhoneOS</key>
  <true/>
  <key>UILaunchStoryboardName</key>
  <string>LaunchScreen</string>
  <key>UIRequiredDeviceCapabilities</key>
  <array>
    <string>arm64</string>
    <string>metal</string>
  </array>
  <key>UISupportedInterfaceOrientations</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>
  <key>UISupportedInterfaceOrientations~ipad</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationPortraitUpsideDown</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>
`);
}

function packetTunnelInfoPlist({ identifier, version }) {
  return plist(`  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>VNT Packet Tunnel</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>${xml(identifier)}.PacketTunnel</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>${xml(version)}</string>
  <key>CFBundleVersion</key>
  <string>${xml(version)}</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.networkextension.packet-tunnel</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).PacketTunnelProvider</string>
  </dict>
`);
}

function loadProjectMetadata() {
  const tauri = readJson(path.join(srcTauri, 'tauri.conf.json'));
  const pkg = readJson(path.join(root, 'package.json'));
  const appName = pkg.name;
  const productName = tauri.productName ?? appName;
  const identifier = tauri.identifier;
  const version = tauri.version ?? pkg.version;

  if (!appName || !identifier || !version) {
    fail('Unable to derive iOS app name, identifier, or version from package.json/tauri.conf.json');
  }

  return { appName, productName, identifier, version };
}

function ensureGeneratedAppleFiles(metadata) {
  const { appName, productName, identifier, version } = metadata;
  const appDir = path.join(genApple, `${appName}_iOS`);
  const tunnelDir = path.join(genApple, 'VntIosVpnTunnel');

  writeIfChanged(path.join(appDir, 'Info.plist'), appInfoPlist({ productName, identifier, version }));
  writeIfChanged(path.join(appDir, `${appName}_iOS.entitlements`), networkExtensionEntitlements());
  writeIfChanged(path.join(tunnelDir, 'PacketTunnelInfo.plist'), packetTunnelInfoPlist({ identifier, version }));
  writeIfChanged(path.join(tunnelDir, 'PacketTunnel.entitlements'), networkExtensionEntitlements());
}

function regenerateProject() {
  const result = spawnSync('xcodegen', ['generate', '--spec', 'project.yml'], {
    cwd: genApple,
    stdio: 'inherit',
  });
  if (result.error) {
    fail(`Unable to run xcodegen: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`xcodegen failed with status ${result.status}`);
  }
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
  if (!pbx.includes('VntIosVpnApp')) {
    console.warn('Generated iOS project does not list VntIosVpnApp explicitly; xcodebuild will validate the synchronized source group.');
  }
  if (!pbx.includes('VntIosVpnBridge.swift')) {
    console.warn('Generated iOS project does not list VntIosVpnBridge.swift explicitly; xcodebuild will validate the synchronized source group.');
  }
  if (!pbx.includes('PacketTunnelProvider.swift')) {
    fail('Generated iOS project does not include PacketTunnelProvider.swift');
  }
  if (!pbx.includes('com.apple.product-type.app-extension')) {
    fail('Generated iOS project does not include an app-extension target');
  }
}

const metadata = loadProjectMetadata();
ensureGeneratedAppleFiles(metadata);
regenerateProject();
patchProject();
console.log('iOS VPN Xcode project includes PacketTunnel target and bridge sources');

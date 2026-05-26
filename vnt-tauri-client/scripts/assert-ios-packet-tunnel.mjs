#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function assertTemplate() {
  const projectYml = path.join(root, 'src-tauri', 'ios-template', 'project.yml');
  const text = fs.readFileSync(projectYml, 'utf8');

  const checks = [
    ['main app embeds PacketTunnel target', /- target: PacketTunnel\s+embed: true/s],
    ['PacketTunnel target exists', /\n  PacketTunnel:\n/s],
    ['PacketTunnel target is an app extension', /\n  PacketTunnel:[\s\S]*?\n    type: app-extension\n/s],
    ['PacketTunnel compiles generated Swift source folder', /\n  PacketTunnel:[\s\S]*?- path: VntIosVpnTunnel\n/s],
    ['PacketTunnel links NetworkExtension.framework', /\n  PacketTunnel:[\s\S]*?- sdk: NetworkExtension\.framework\n/s],
  ];

  for (const [name, pattern] of checks) {
    if (!pattern.test(text)) {
      fail(`iOS template check failed: ${name}`);
    }
  }
}

function assertIpa(ipaPath) {
  if (!fs.existsSync(ipaPath)) {
    fail(`IPA does not exist: ${ipaPath}`);
  }

  const result = spawnSync('unzip', ['-Z1', ipaPath], { encoding: 'utf8' });
  if (result.error) {
    fail(`Unable to inspect IPA with unzip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Unable to inspect IPA: ${result.stderr || result.stdout}`);
  }

  const entries = result.stdout.split(/\r?\n/).filter(Boolean);
  const hasEntry = (pattern) => entries.some((entry) => pattern.test(entry));
  const checks = [
    ['embedded PacketTunnel.appex bundle', /^Payload\/[^/]+\.app\/PlugIns\/PacketTunnel\.appex\//],
    ['PacketTunnel executable', /^Payload\/[^/]+\.app\/PlugIns\/PacketTunnel\.appex\/PacketTunnel$/],
    ['PacketTunnel Info.plist', /^Payload\/[^/]+\.app\/PlugIns\/PacketTunnel\.appex\/Info\.plist$/],
  ];

  for (const [name, pattern] of checks) {
    if (!hasEntry(pattern)) {
      fail(`IPA check failed: missing ${name}`);
    }
  }
}

const ipaPath = process.argv[2];
assertTemplate();
if (ipaPath) {
  assertIpa(path.resolve(process.cwd(), ipaPath));
}
console.log('iOS PacketTunnel checks passed');

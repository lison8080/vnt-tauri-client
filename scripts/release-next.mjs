#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

function run(command, commandArgs, options = {}) {
  const output = execFileSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });

  return typeof output === 'string' ? output.trim() : '';
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, data) {
  const target = path.join(repoRoot, relativePath);
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
}

function parseTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function ensureCleanWorktree() {
  const status = run('git', ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error('working tree is not clean; commit or stash changes before running release-next');
  }
}

function nextPatchVersion() {
  run('git', ['fetch', '--tags', '--force'], { stdio: 'inherit' });
  const tags = run('git', ['tag', '--list', 'v[0-9]*.[0-9]*.[0-9]*', '--sort=-v:refname'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const latest = tags.map(parseTag).find(Boolean);

  if (!latest) {
    return '0.1.0';
  }

  return `${latest.major}.${latest.minor}.${latest.patch + 1}`;
}

function updateVersions(version) {
  const packageJson = readJson('vnt-tauri-client/package.json');
  packageJson.version = version;
  writeJson('vnt-tauri-client/package.json', packageJson);

  const packageLock = readJson('vnt-tauri-client/package-lock.json');
  packageLock.version = version;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }
  writeJson('vnt-tauri-client/package-lock.json', packageLock);

  const tauriConfig = readJson('vnt-tauri-client/src-tauri/tauri.conf.json');
  tauriConfig.version = version;
  writeJson('vnt-tauri-client/src-tauri/tauri.conf.json', tauriConfig);
}

function main() {
  if (!dryRun) {
    ensureCleanWorktree();
  }

  const version = nextPatchVersion();
  const tag = `v${version}`;

  if (dryRun) {
    console.log(`next version: ${version}`);
    console.log(`next tag: ${tag}`);
    return;
  }

  updateVersions(version);

  const changed = run('git', ['status', '--porcelain']);
  if (changed.length > 0) {
    run('git', ['add', 'vnt-tauri-client/package.json', 'vnt-tauri-client/package-lock.json', 'vnt-tauri-client/src-tauri/tauri.conf.json'], {
      stdio: 'inherit',
    });
    run('git', ['commit', '-m', `chore: release ${tag}`], { stdio: 'inherit' });
  }

  run('git', ['tag', tag], { stdio: 'inherit' });
  console.log(tag);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

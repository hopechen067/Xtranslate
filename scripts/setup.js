'use strict';

// Install deps, build the Windows portable exe, launch it (Windows only).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const version = require(path.join(root, 'package.json')).version;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  const code = result.status === null ? 1 : result.status;
  if (code !== 0) process.exit(code);
}

function findPortableExe() {
  const candidates = [
    path.join(dist, 'Xtranslate-portable.exe'),
    path.join(dist, `Xtranslate-portable-${version}.exe`),
    path.join(dist, `Xtranslate ${version}.exe`),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  if (!fs.existsSync(dist)) return null;
  const fallback = fs.readdirSync(dist)
    .filter((name) => name.endsWith('.exe') && !/setup/i.test(name))
    .map((name) => path.join(dist, name));
  return fallback[0] || null;
}

console.log('[setup] npm install');
run('npm', ['install']);

console.log('[setup] building Windows portable exe');
run('npx', ['electron-builder', '--win', 'portable', '--x64']);

const exe = findPortableExe();
if (!exe) {
  console.error('[setup] portable exe not found in dist/');
  process.exit(1);
}

if (process.platform !== 'win32') {
  console.log(`[setup] built ${exe}`);
  console.log('[setup] this machine is not Windows; copy the exe to a Windows PC to run it.');
  process.exit(0);
}

console.log(`[setup] launching ${exe}`);
const child = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  cwd: path.dirname(exe),
});
child.unref();

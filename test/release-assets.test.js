'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release-windows.yml'), 'utf8');
const install = fs.readFileSync(path.join(root, 'scripts/install.ps1'), 'utf8');
const setup = fs.readFileSync(path.join(root, 'scripts/setup.js'), 'utf8');

test('electron-builder 产物名固定，供安装脚本下载', () => {
  assert.equal(pkg.build.portable.artifactName, 'Xtranslate-portable.${ext}');
  assert.equal(pkg.build.nsis.artifactName, 'Xtranslate-Setup.${ext}');
  assert.equal(pkg.build.nsis.perMachine, false);
});

test('workflow / install.ps1 / setup.js 使用同一套 Release 资源名', () => {
  assert.match(workflow, /Xtranslate-portable\.exe/);
  assert.match(workflow, /Xtranslate-Setup\.exe/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*'/);
  assert.match(workflow, /workflow_dispatch:/);

  assert.match(install, /\$AssetName = 'Xtranslate-portable\.exe'/);
  assert.match(install, /hopechen067\/Xtranslate/);
  assert.match(install, /XTRANSLATE_MIRROR/);
  assert.match(install, /LOCALAPPDATA/);

  assert.match(setup, /Xtranslate-portable\.exe/);
  assert.match(pkg.scripts.setup, /scripts\/setup\.js/);
  assert.match(workflow, /electron-builder --win nsis portable --x64 --publish never/);
  assert.match(pkg.scripts.dist, /electron-builder --win nsis portable --x64 --publish never/);
});

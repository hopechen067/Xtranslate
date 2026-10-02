'use strict';

// 主进程依赖 Electron，单元测试 require 不到；至少保证每个源文件都能被解析。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

test('src 下所有 JS 文件语法正确', () => {
  const files = jsFiles(path.join(__dirname, '..', 'src'));
  assert.ok(files.length > 10);
  for (const f of files) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`${path.relative(process.cwd(), f)}\n${err.stderr}`);
    }
  }
});

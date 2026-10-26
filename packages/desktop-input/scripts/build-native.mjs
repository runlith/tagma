#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const nativeRoot = join(packageRoot, 'native', 'desktop-input');
const outDir = join(packageRoot, 'bin');
const outBin = join(outDir, 'runlith-desktop-input');
const builtName = 'desktop-input';

const requireDarwin = process.argv.includes('--require-darwin');
const singleArch = process.argv.includes('--single-arch');

if (process.platform !== 'darwin') {
  if (requireDarwin) {
    console.error('[desktop-input] native build requires macOS (darwin)');
    process.exit(1);
  }
  console.log('[desktop-input] skipping native build (non-darwin)');
  process.exit(0);
}

if (!existsSync(nativeRoot)) {
  console.error('[desktop-input] native sources missing:', nativeRoot);
  process.exit(1);
}

const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { cwd: nativeRoot, stdio: 'inherit' });
  if (typeof res.status !== 'number' || res.status !== 0) {
    process.exit(res.status ?? 1);
  }
};

const resolveBuiltBinary = (arch) => {
  run('swift', ['build', '-c', 'release', '-j', '3', '-Xlinker', '-S', '--arch', arch]);

  const binPathRes = spawnSync('swift', ['build', '-c', 'release', '-Xlinker', '-S', '--show-bin-path', '--arch', arch], {
    cwd: nativeRoot,
    encoding: 'utf8',
  });
  if (binPathRes.status !== 0) {
    process.exit(binPathRes.status ?? 1);
  }

  const binPath = String(binPathRes.stdout ?? '').trim();
  if (!binPath) {
    console.error('[desktop-input] failed to resolve swift --show-bin-path for arch:', arch);
    process.exit(1);
  }

  const built = join(binPath, builtName);
  if (!existsSync(built)) {
    console.error('[desktop-input] built binary not found for arch:', arch, built);
    process.exit(1);
  }

  return built;
};

mkdirSync(outDir, { recursive: true });

if (singleArch) {
  const built = resolveBuiltBinary(process.arch === 'arm64' ? 'arm64' : 'x86_64');
  copyFileSync(built, outBin);
  chmodSync(outBin, 0o755);
  console.log('[desktop-input] wrote', outBin, '(single-arch)');
  process.exit(0);
}

const builtArm64 = resolveBuiltBinary('arm64');
const builtX64 = resolveBuiltBinary('x86_64');

run('lipo', ['-create', builtArm64, builtX64, '-output', outBin]);
chmodSync(outBin, 0o755);
console.log('[desktop-input] wrote', outBin, '(universal arm64+x64)');

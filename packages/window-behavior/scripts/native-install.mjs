import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const nativeDir = resolve(packageRoot, 'native');
const addonPath = resolve(nativeDir, 'build', 'Release', 'window_behavior_native.node');
const strict = process.argv.includes('--required');

main();

function main() {
  if (process.platform !== 'darwin') {
    const message = '[window-behavior] Native no-focus-steal support is macOS-only. Skipping native build.';

    if (strict) {
      console.error(message);
      process.exit(1);
    }

    console.log(message);
    return;
  }

  ensureXcodeCommandLineTools();
  runNodeGypRebuild();

  if (!existsSync(addonPath)) {
    console.error(`[window-behavior] Native build finished without producing the expected addon: ${addonPath}`);
    process.exit(1);
  }

  console.log(`[window-behavior] Native addon is ready: ${addonPath}`);
}

function ensureXcodeCommandLineTools() {
  const result = spawnSync('xcode-select', ['-p'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (result.status === 0) {
    return;
  }

  console.error('[window-behavior] Xcode Command Line Tools are required to build the macOS native addon.');
  console.error('[window-behavior] Install them with `xcode-select --install` and retry `native:install`.');
  process.exit(1);
}

function runNodeGypRebuild() {
  const nodeGypPath = require.resolve('node-gyp/bin/node-gyp.js');
  const result = spawnSync('node', [nodeGypPath, 'rebuild', '--directory', nativeDir], {
    cwd: packageRoot,
    stdio: 'inherit',
  });

  if (result.status === 0) {
    return;
  }

  if (result.error) {
    console.error('[window-behavior] Failed to launch Bun for node-gyp rebuild.');
    console.error(result.error);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

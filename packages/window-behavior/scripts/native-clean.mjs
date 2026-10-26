import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeBuildDir = resolve(packageRoot, 'native', 'build');

if (!existsSync(nativeBuildDir)) {
  console.log('[window-behavior] No native build directory to clean.');
  process.exit(0);
}

rmSync(nativeBuildDir, {
  recursive: true,
  force: true,
});

console.log(`[window-behavior] Removed native build directory: ${nativeBuildDir}`);

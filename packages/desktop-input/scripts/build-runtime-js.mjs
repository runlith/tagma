import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(packageRoot, 'dist');

rmSync(outDir, { recursive: true, force: true });

await build({
  entryPoints: ['contract/types.ts', 'DesktopInputHost.ts', 'preflight.ts'].map((entry) => resolve(packageRoot, 'src', entry)),
  outbase: resolve(packageRoot, 'src'),
  outdir: outDir,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  sourcemap: true,
});

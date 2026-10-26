import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverPort, surfaceDevPort } from '@tagma/server/installation/contract/wire/ports';
import { hostBinary } from '@tagma/server/installation/contract/wire/layout';
import { CHANNEL } from '@tagma/server/composition/channel';
import { runDev } from '@runlith/dev-runner';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productRoot = resolve(packageRoot, '..');
const distDir = join(packageRoot, 'dist');
const surfaceEnv = { ...process.env };
delete surfaceEnv.TAGMA_SURFACE_OUT;

const port = serverPort(CHANNEL, process.env);
const serverUrl = new URL(`http://127.0.0.1:${port}`);
const viteUrl = new URL(`http://localhost:${surfaceDevPort(port)}/`);
const surfaceUrl = process.env.TAGMA_SURFACE_URL?.trim() || viteUrl.toString();

await runDev({
  label: 'tagma-desktop-dev',
  steps: [
    {
      name: 'window-behavior',
      command: 'bun',
      args: ['run', 'build'],
      cwd: resolve(productRoot, '..', '..', 'packages', 'window-behavior'),
    },
    { name: 'host', command: 'bun', args: ['scripts/build-host.ts', '--unembedded'], cwd: packageRoot },
  ],
  processes: [
    {
      name: 'server',
      command: 'bun',
      args: ['run', 'start'],
      cwd: resolve(productRoot, 'server'),
      readyUrl: new URL('/health', serverUrl),
      whenRunning: 'adopt',
    },
    {
      name: 'surface',
      command: 'bun',
      args: ['run', '--bun', 'vite'],
      cwd: resolve(productRoot, 'app'),
      env: surfaceEnv,
      readyUrl: viteUrl,
      whenRunning: 'adopt',
    },
    { name: 'bundles', command: 'bun', args: ['scripts/build-host.ts', '--watch'], cwd: packageRoot },
    {
      name: 'window',
      command: electronCommand(),
      args: [join(distDir, 'app', 'main.mjs'), `--tagma-surface-url=${surfaceUrl}`],
      cwd: packageRoot,
      restartOn: { dir: join(distDir, 'app'), suffix: '.mjs' },
    },
  ],
});

function electronCommand(): string {
  const binary = createRequire(import.meta.url)('electron') as string;
  return process.platform === 'darwin' ? join(distDir, hostBinary(CHANNEL.name)) : binary;
}

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverPort } from '@tagma/server/installation/contract/wire/ports';
import { CHANNEL } from '@tagma/server/composition/channel';
import { runDev } from '@runlith/dev-runner';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(scriptDir);
const productRoot = resolve(appRoot, '..');

const port = serverPort(CHANNEL, process.env);
const serverUrl = new URL(`http://127.0.0.1:${port}`);

const replaceServer = process.argv.includes('--replace-server');

const devEnv = { ...process.env };
delete devEnv.TAGMA_SURFACE_OUT;

await runDev({
  label: CHANNEL.command,
  processes: [
    {
      name: 'server',
      command: 'bun',
      args: ['run', 'start'],
      cwd: resolve(productRoot, 'server'),
      env: process.env,
      readyUrl: new URL('/health', serverUrl),
      whenRunning: replaceServer ? 'replace' : 'adopt',
    },
    { name: 'app', command: 'bun', args: ['run', '--bun', 'vite'], cwd: appRoot, env: devEnv },
  ],
});

import { fileURLToPath } from 'node:url';
import type { SqliteReply } from './channel.js';
import type { Host, Hosting } from './hosting.js';

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));
const SIGNALS_IGNORED = 'trap "" HUP INT TERM; exec "$0" "$@"';

export const childHosting: Hosting = (receive, onExit) => {
  const child = Bun.spawn(['/bin/sh', '-c', SIGNALS_IGNORED, process.execPath, 'run', CHILD], {
    detached: true,
    ipc: (message: unknown) => receive(message as SqliteReply),
    stdio: ['ignore', 'inherit', 'inherit'],
    onExit: (_child, code) => onExit(host, code),
  });
  const host: Host = {
    pid: child.pid,
    spawned: true,
    get signalCode() {
      return child.signalCode;
    },
    exited: child.exited,
    send: (request) => {
      child.send(request);
    },
    kill: (signal) => (signal === undefined ? child.disconnect() : child.kill(signal)),
  };
  return host;
};

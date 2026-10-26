import { fileURLToPath } from 'node:url';
import type { SqliteReply } from './channel.js';
import type { Host, Hosting } from './hosting.js';

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

export const childHosting: Hosting = (receive, onExit) => {
  const child = Bun.spawn([process.execPath, 'run', CHILD], {
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
    kill: (signal) => child.kill(signal),
  };
  return host;
};

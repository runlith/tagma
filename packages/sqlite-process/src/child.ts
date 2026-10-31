/// <reference types="bun" />

import type { SqliteRequest, SqliteReply } from './channel.js';
import { selectEngine } from './engine.js';
import { makeSqliteHost } from './host.js';

selectEngine();

const orphaned = (): boolean => !process.connected;

const host = makeSqliteHost((reply) => {
  if (orphaned()) leave();
  process.send?.(reply satisfies SqliteReply);
});

const leave = (): never => {
  host.close();
  process.exit(0);
};

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (orphaned() || (host.open() === 0 && !host.maintaining())) leave();
  });
}

process.on('message', (message) => {
  const request = message as SqliteRequest;
  const { ask } = request;
  host.serve(request, ask._tag === 'Run' || ask._tag === 'Programs' ? Math.max(0, Date.now() - ask.sentAt) : 0);
});

process.on('disconnect', leave);

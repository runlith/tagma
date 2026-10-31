import type { SqliteRequest, SqliteSaid } from './channel.js';
import { selectEngine } from './engine.js';
import { busy, makeSqliteHost } from './host.js';
import type { Host, Hosting } from './hosting.js';

const BUSY_RETRY_MS = 2;

type Queued = { readonly request: SqliteRequest; readonly sentAt: number; startedAt: number | undefined };

const timed = (said: SqliteSaid, queueMs: number, execMs: number): SqliteSaid =>
  said._tag === 'Rows' || said._tag === 'Failed' || said._tag === 'Committed' ? { ...said, queueMs, execMs } : said;

export const inlineHosting: Hosting = (receive, onExit) => {
  selectEngine();
  let killed = false;
  let scheduled = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let exited: () => void = () => undefined;
  const queue: Queued[] = [];
  const sqlite = makeSqliteHost(receive, 'caller');
  const drain = (): void => {
    retry = undefined;
    while (!killed && queue.length > 0) {
      const queued = queue[0]!;
      const now = performance.now();
      queued.startedAt ??= now;
      const said = sqlite.answer(queued.request, 0);
      const { ask } = queued.request;
      if (
        busy(said) &&
        (ask._tag === 'Run' || ask._tag === 'Open' || ask._tag === 'Programs') &&
        now - queued.startedAt < sqlite.busyTimeoutMs(queued.request)
      ) {
        retry = setTimeout(drain, BUSY_RETRY_MS);
        return;
      }
      queue.shift();
      sqlite.answered(queued.request, timed(said, queued.startedAt - queued.sentAt, performance.now() - queued.startedAt));
    }
    scheduled = false;
  };
  const host: Host = {
    pid: process.pid,
    spawned: false,
    signalCode: null,
    exited: new Promise<void>((resolve) => {
      exited = resolve;
    }),
    send: (request) => {
      if (killed) throw new Error('the in-process sqlite host is closed');
      queue.push({ request, sentAt: performance.now(), startedAt: undefined });
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(drain);
    },
    kill: () => {
      if (killed) return;
      killed = true;
      clearTimeout(retry);
      queue.length = 0;
      sqlite.close();
      exited();
      onExit(host, 0);
    },
  };
  return host;
};

/// <reference types="bun" />

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { closeOnExec, lockExclusive, unlock } from '@runlith/file-lock/flock';
import { type EngineHearing, openEngine } from './engine.js';
import {
  CHANGES_PER_LINE,
  READY,
  decodeAsk,
  lines,
  type Outbox,
  outbox,
  type WatchAsk,
  type WatchChange,
  type WatchSaid,
} from './protocol.js';

const BACKLOG_BYTES = Math.max(16 * 2 ** 20, Math.floor(totalmem() / 256));

const CLAIM_EVERY_MS = 20;

const DETACHED_MS = 10 * 60_000;

const ALONE_MS = 60 * 60_000;

const SWEEP_EVERY_MS = 60_000;

const COOKIE = '.watch-cookie-';

const COOKIE_EVERY_MS = 20;

let cookies = 0;

type Connection = {
  readonly ids: Map<number, Native>;
  readonly read: (chunk: Uint8Array) => void;
  readonly out: Outbox;
};

type Peer = Bun.Socket<Connection>;

type Client = { readonly peer: Peer; readonly id: number };

type Moved = { seq: number; kind: WatchChange['kind']; heard: WatchChange['heard'] };

type Native = {
  readonly key: string;
  readonly root: string;
  readonly recursive: boolean;
  readonly ignore: readonly string[];
  readonly awaited: Map<string, (seen: boolean) => void>;
  readonly clients: Set<Client>;
  readonly epoch: string;
  readonly moved: Map<string, Moved> | null;
  opening: Promise<void>;
  busy: Promise<void>;
  subscription: number | null;
  seq: number;
  floor: number;
  detachedAt: number | null;
  ended: boolean;
};

const [socketWord, retainWord, lifetime] = process.argv.slice(2);
if (socketWord === undefined) throw new Error('the watcher takes the path of its socket');
const socketPath: string = socketWord;
const RETAIN = Number(retainWord);
if (!Number.isSafeInteger(RETAIN) || RETAIN < 1)
  throw new Error(`the watcher takes how many changed paths a root keeps, not ${retainWord}`);
const DETACHED = lifetime === 'detached';
const OWNED = lifetime === 'with-client';

const engine = openEngine();
const natives = new Map<string, Native>();
const epochs = new Map<string, Native>();
const peers = new Set<Peer>();
let connectedAt = Date.now();
let aloneSince: number | null = Date.now();
let retiring = false;

const send = (peer: Peer, said: WatchSaid): void => {
  peer.data.out.push(`${JSON.stringify(said)}\n`);
  if (peer.data.out.pending() <= BACKLOG_BYTES) return;
  console.error(`[watch] a client read nothing while ${BACKLOG_BYTES} bytes waited for it, so its connection is closed`);
  peer.terminate();
};

const tell = (native: Native, said: (id: number) => WatchSaid): void => {
  for (const client of native.clients) send(client.peer, said(client.id));
};

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const uncookied = (changes: readonly WatchChange[]): WatchChange[] =>
  changes.filter((change) => !change.path.startsWith(COOKIE) || change.path.includes('/'));

const recorded = (native: Native, changes: readonly WatchChange[]): void => {
  const moved = native.moved;
  if (moved === null || changes.length === 0) return;
  native.seq += 1;
  for (const change of changes) {
    moved.delete(change.path);
    moved.set(change.path, { seq: native.seq, kind: change.kind, heard: change.heard });
  }
  for (const [path, held] of moved) {
    if (moved.size <= RETAIN) break;
    moved.delete(path);
    native.floor = Math.max(native.floor, held.seq);
  }
};

const lostTrack = (native: Native): void => {
  native.seq += 1;
  native.floor = native.seq;
  native.moved?.clear();
};

const deliver = (native: Native, changes: readonly WatchChange[]): void => {
  recorded(native, changes);
  for (let from = 0; from < changes.length; from += CHANGES_PER_LINE) {
    const part = changes.slice(from, from + CHANGES_PER_LINE).map(({ heard: _, ...change }) => change);
    tell(native, (id) => ({ t: 'heard', id, changes: part }));
  }
};

const retire = async (native: Native): Promise<void> => {
  const held = native.subscription;
  native.subscription = null;
  if (held === null) return;
  await engine
    .unsubscribe(held)
    .catch((cause: unknown) => console.error(`[watch] ${native.root} could not be unsubscribed: ${reasonOf(cause)}`));
};

const end = (native: Native, reason: string): void => {
  if (native.ended) return;
  native.ended = true;
  if (natives.get(native.key) === native) natives.delete(native.key);
  epochs.delete(native.epoch);
  tell(native, (id) => ({ t: 'ended', id, reason }));
  for (const client of native.clients) client.peer.data.ids.delete(client.id);
  native.clients.clear();
  for (const waiting of native.awaited.values()) waiting(false);
  native.awaited.clear();
  native.busy = native.busy.then(() => retire(native));
};

const hearing = (native: Native): EngineHearing => ({
  heard: (changes) => {
    if (native.ended) return;
    deliver(native, uncookied(changes));
    if (native.awaited.size === 0) return;
    for (const change of changes) {
      const waiting = native.awaited.get(change.path);
      if (waiting === undefined) continue;
      native.awaited.delete(change.path);
      waiting(true);
    }
  },
  dropped: (subtree, reason) => {
    if (native.ended) return;
    lostTrack(native);
    for (const waiting of native.awaited.values()) waiting(false);
    native.awaited.clear();
    tell(native, (id) => ({ t: 'dropped', id, subtree, reason }));
  },
  ended: (reason) => end(native, reason),
});

const opened = (key: string, root: string, recursive: boolean, ignore: readonly string[]): Native => {
  const native: Native = {
    key,
    root,
    recursive,
    ignore,
    awaited: new Map(),
    clients: new Set(),
    epoch: randomUUID(),
    moved: recursive ? new Map() : null,
    opening: Promise.resolve(),
    busy: Promise.resolve(),
    subscription: null,
    seq: 0,
    floor: 0,
    detachedAt: null,
    ended: false,
  };
  epochs.set(native.epoch, native);
  native.opening = engine.subscribe(root, recursive, ignore, hearing(native)).then(
    async (subscription) => {
      if (native.ended) return await engine.unsubscribe(subscription);
      native.subscription = subscription;
    },
    (cause: unknown) => {
      if (natives.get(key) === native) natives.delete(key);
      epochs.delete(native.epoch);
      native.ended = true;
      throw cause;
    },
  );
  native.busy = native.opening.catch(() => undefined);
  return native;
};

const realOf = (at: string): string | Error => {
  try {
    return realpathSync(at);
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
};

const subscribed = async (peer: Peer, ask: Extract<WatchAsk, { t: 'subscribe' }>): Promise<void> => {
  const root = realOf(ask.at);
  if (root instanceof Error) return send(peer, { t: 'refused', id: ask.id, reason: root.message });
  const key = JSON.stringify([root, ask.recursive, ask.ignore]);
  const native = natives.get(key) ?? opened(key, root, ask.recursive, ask.ignore);
  natives.set(key, native);
  const client: Client = { peer, id: ask.id };
  native.clients.add(client);
  native.detachedAt = null;
  peer.data.ids.set(ask.id, native);
  try {
    await native.opening;
    if (native.clients.has(client)) send(peer, { t: 'subscribed', id: ask.id });
    else send(peer, { t: 'refused', id: ask.id, reason: `${root} stopped being watched before its watch opened` });
  } catch (cause) {
    native.clients.delete(client);
    if (peer.data.ids.get(ask.id) === native) peer.data.ids.delete(ask.id);
    send(peer, { t: 'refused', id: ask.id, reason: reasonOf(cause) });
  }
};

const detach = (native: Native, client: Client): void => {
  native.clients.delete(client);
  if (native.clients.size === 0 && !native.ended) native.detachedAt = Date.now();
};

const unsubscribed = async (peer: Peer, id: number): Promise<void> => {
  const native = peer.data.ids.get(id);
  peer.data.ids.delete(id);
  if (native !== undefined) {
    for (const client of native.clients) if (client.peer === peer && client.id === id) native.clients.delete(client);
    if (native.clients.size === 0) {
      end(native, 'its last client left');
      await native.busy;
    }
  }
  send(peer, { t: 'unsubscribed', id });
};

const recording = (at: string, ignore: readonly string[]): Native | null => {
  const root = realOf(at);
  if (root instanceof Error) return null;
  const live = (native: Native | undefined): native is Native =>
    native !== undefined && native.moved !== null && !native.ended && native.subscription !== null;
  const own = natives.get(JSON.stringify([root, true, ignore]));
  if (live(own)) return own;
  for (const native of natives.values()) if (native.root === root && live(native)) return native;
  return null;
};

const cursorOf = (at: string, ignore: readonly string[]): string | null => {
  const native = recording(at, ignore);
  return native === null ? null : `${native.epoch}:${native.seq}`;
};

const settled = async (at: string, ignore: readonly string[]): Promise<boolean> => {
  const native = recording(at, ignore);
  if (native === null) return false;
  const name = `${COOKIE}${process.pid}-${++cookies}`;
  const seen = new Promise<boolean>((resolve) => native.awaited.set(name, resolve));
  try {
    writeFileSync(join(native.root, name), '');
  } catch (cause) {
    native.awaited.delete(name);
    console.error(`[watch] ${native.root} took no cookie, so its delivery cannot be settled: ${reasonOf(cause)}`);
    return false;
  }
  try {
    return await seen;
  } finally {
    rmSync(join(native.root, name), { force: true });
  }
};

const movedSince = (at: string, cursor: string): WatchChange[] | null => {
  const cut = cursor.lastIndexOf(':');
  const native = epochs.get(cursor.slice(0, cut));
  const seq = Number(cursor.slice(cut + 1));
  const root = realOf(at);
  if (native === undefined || native.ended || native.moved === null || root instanceof Error || native.root !== root) return null;
  if (!Number.isSafeInteger(seq) || seq < native.floor || seq > native.seq) return null;
  const changes: WatchChange[] = [];
  for (const [path, held] of native.moved) {
    if (held.seq > seq) changes.push(held.heard === undefined ? { kind: held.kind, path } : { kind: held.kind, path, heard: held.heard });
  }
  return changes;
};

const settledSince = async (root: string, snapshot: string, ignore: readonly string[]): Promise<WatchChange[] | null> => {
  if (!existsSync(snapshot)) return null;
  const name = `${COOKIE}${process.pid}-${++cookies}`;
  try {
    writeFileSync(join(root, name), '');
  } catch (cause) {
    console.error(`[watch] ${root} took no cookie, so what changed since its snapshot is unknown: ${reasonOf(cause)}`);
    return null;
  }
  try {
    for (;;) {
      const changes = await engine.since(root, ignore, snapshot);
      if (changes === null) return null;
      if (changes.some((change) => change.path === name)) return uncookied(changes);
      await Bun.sleep(COOKIE_EVERY_MS);
    }
  } finally {
    rmSync(join(root, name), { force: true });
  }
};

const refusing = async (peer: Peer, id: number, work: () => Promise<WatchSaid> | WatchSaid): Promise<void> => {
  try {
    send(peer, await work());
  } catch (cause) {
    send(peer, { t: 'refused', id, reason: reasonOf(cause) });
  }
};

const answered = async (peer: Peer, ask: WatchAsk): Promise<void> => {
  switch (ask.t) {
    case 'subscribe':
      return subscribed(peer, ask);
    case 'unsubscribe':
      return unsubscribed(peer, ask.id);
    case 'snapshot':
      return refusing(peer, ask.id, async () => {
        await engine.snapshot(realpathSync(ask.at), ask.ignore, ask.snapshot);
        return { t: 'written', id: ask.id };
      });
    case 'since':
      return refusing(peer, ask.id, async () => ({
        t: 'changed',
        id: ask.id,
        changes: await settledSince(realpathSync(ask.at), ask.snapshot, ask.ignore),
      }));
    case 'cursor':
      return send(peer, { t: 'cursor', id: ask.id, cursor: cursorOf(ask.at, ask.ignore) });
    case 'settle':
      return send(peer, { t: 'settled', id: ask.id, settled: await settled(ask.at, ask.ignore) });
    case 'moved':
      return send(peer, { t: 'moved', id: ask.id, changes: movedSince(ask.at, ask.cursor) });
    case 'retire':
      retiring = true;
      send(peer, { t: 'done', id: ask.id });
      return;
    case 'shutdown':
      send(peer, { t: 'done', id: ask.id });
      peer.flush();
      return stop();
  }
};

const connection = (peer: Peer): Connection => ({
  ids: new Map(),
  out: outbox((bytes) => peer.write(bytes)),
  read: lines((line) => {
    const ask = decodeAsk(line);
    if (ask._tag === 'Failure') {
      console.error(`[watch] a client sent what is no ask: ${line.slice(0, 200)}`);
      peer.end();
      return;
    }
    void answered(peer, ask.success);
  }),
});

const gone = (peer: Peer): void => {
  if (!peers.delete(peer)) return;
  for (const [id, native] of peer.data.ids) {
    const client = [...native.clients].find((one) => one.peer === peer && one.id === id);
    if (client !== undefined) detach(native, client);
  }
  peer.data.ids.clear();
  if (peers.size > 0) return;
  aloneSince = Date.now();
  if (retiring || OWNED) void stop();
};

const sweep = (): void => {
  const now = Date.now();
  if (peers.size === 0) {
    if (aloneSince !== null && now - aloneSince >= ALONE_MS) void stop();
    return;
  }
  for (const native of [...natives.values()]) {
    if (native.detachedAt === null || native.clients.size > 0) continue;
    if (now - Math.max(native.detachedAt, connectedAt) >= DETACHED_MS) end(native, 'no client watched it again');
  }
};

const serving = async (): Promise<boolean> => {
  try {
    const probe = await Bun.connect({ unix: socketPath, socket: { data: () => undefined } });
    probe.end();
    return true;
  } catch {
    return false;
  }
};

const guard = (() => {
  mkdirSync(dirname(socketPath), { recursive: true });
  const fd = openSync(`${socketPath}.lock`, 'a');
  closeOnExec(fd);
  return fd;
})();

const claimed = async <A>(work: () => Promise<A> | A): Promise<A> => {
  while (lockExclusive(guard) === 'held') await Bun.sleep(CLAIM_EVERY_MS);
  try {
    return await work();
  } finally {
    unlock(guard);
  }
};

const inodeAt = (path: string): number | null => statSync(path, { throwIfNoEntry: false })?.ino ?? null;

const bound = await claimed(async () => {
  if (await serving()) return null;
  rmSync(socketPath, { force: true });
  const listener = Bun.listen<Connection>({
    unix: socketPath,
    socket: {
      open: (peer) => {
        peer.data = connection(peer);
        peers.add(peer);
        connectedAt = Date.now();
        aloneSince = null;
      },
      data: (peer, chunk) => peer.data.read(chunk),
      drain: (peer) => peer.data.out.flush(),
      close: gone,
      error: (peer, cause) => {
        console.error(`[watch] a client connection failed: ${reasonOf(cause)}`);
        gone(peer);
      },
    },
  });
  return { listener, inode: inodeAt(socketPath) };
});

if (bound === null) {
  closeSync(guard);
  process.exit(0);
}

let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  bound?.listener.stop(true);
  await claimed(() => {
    if (bound !== null && bound.inode !== null && inodeAt(socketPath) === bound.inode) rmSync(socketPath, { force: true });
  });
  process.exit(0);
}

setInterval(sweep, SWEEP_EVERY_MS).unref();
if (!DETACHED) {
  process.stdin.on('end', () => void stop());
  process.stdin.on('close', () => void stop());
  process.stdin.resume();
}
process.stdout.write(`${READY}\n`);

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type PendingHookWrite = {
  readonly kind: 'hook-write';
  readonly path: string;
  readonly base: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly capturedAt: string;
  readonly key: string;
};

export type RefusedHookWrite = PendingHookWrite & {
  readonly refusal: { readonly code: string; readonly reason: string };
};

export type HookWriteUnread = {
  readonly kind: 'hook-write-unread';
  readonly key: string;
  readonly path: string;
  readonly operation: 'list' | 'archive' | 'read' | 'parse' | 'shape';
  readonly code: string;
  readonly reason: string;
  readonly capturedAt: string;
};

export type PendingHookRead = {
  readonly ops: readonly PendingHookWrite[];
  readonly unread: readonly HookWriteUnread[];
};

export function keepUnreadOp(dir: string, op: HookWriteUnread): string | undefined {
  const at = join(dir, 'unread');
  return keepDocument(at, op.key, op) ? join(at, `${fileNameOf(op.key)}.json`) : undefined;
}

export function keepRefusedOp(dir: string, op: RefusedHookWrite): string | undefined {
  const archive = join(dir, 'refused');
  if (keepPendingOp(archive, op)) return archive;
  return keepPendingOp(dir, op) ? dir : undefined;
}

const fileNameOf = (key: string): string => key.replace(/[^\w.-]/g, (char) => `%${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

const isMissing = (cause: unknown): boolean => cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function keepPendingOp(dir: string, op: PendingHookWrite): boolean {
  return keepDocument(dir, op.key, op);
}

function keepDocument(dir: string, key: string, document: PendingHookWrite | HookWriteUnread): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const staging = join(dir, `${fileNameOf(key)}.${crypto.randomUUID()}.pending`);
    writeFileSync(staging, JSON.stringify(document));
    renameSync(staging, join(dir, `${fileNameOf(key)}.json`));
    return true;
  } catch {
    return false;
  }
}

export function listPendingOps(dir: string): PendingHookRead {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    return { ops: [], unread: isMissing(cause) ? [] : [unreadAt(dir, 'list', codeOf(cause, 'list-failed'), cause)] };
  }
  const ops: PendingHookWrite[] = [];
  const unread: HookWriteUnread[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    let text: string;
    try {
      if (statSync(join(dir, 'refused', name), { throwIfNoEntry: false }) !== undefined) continue;
    } catch (cause) {
      if (codeOf(cause, '') !== 'ENOTDIR') {
        unread.push(unreadAt(path, 'archive', codeOf(cause, 'archive-unread'), cause));
        continue;
      }
    }
    try {
      text = readFileSync(path, 'utf8');
    } catch (cause) {
      if (!isMissing(cause)) unread.push(unreadAt(path, 'read', codeOf(cause, 'read-failed'), cause));
      continue;
    }
    let stored: unknown;
    try {
      stored = JSON.parse(text);
    } catch (cause) {
      unread.push(unreadAt(path, 'parse', 'invalid-json', cause));
      continue;
    }
    const op = isRecord(stored) ? hookOp(stored) : undefined;
    if (op === undefined || `${fileNameOf(op.key)}.json` !== name) {
      unread.push(unreadAt(path, 'shape', 'invalid-shape', 'the captured hook write does not match its stored shape or key'));
    } else if (!('refusal' in op)) {
      ops.push(op);
    }
  }
  ops.sort((left, right) =>
    left.capturedAt < right.capturedAt ? -1 : left.capturedAt > right.capturedAt ? 1 : left.key < right.key ? -1 : 1,
  );
  return { ops, unread };
}

const codeOf = (cause: unknown, fallback: string): string => (isRecord(cause) && typeof cause.code === 'string' ? cause.code : fallback);

const unreadAt = (path: string, operation: HookWriteUnread['operation'], code: string, cause: unknown): HookWriteUnread => {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const key = new Bun.CryptoHasher('sha256')
    .update(JSON.stringify([path, operation, code, reason]))
    .digest('hex')
    .slice(0, 32);
  return { kind: 'hook-write-unread', key, path, operation, code, reason, capturedAt: new Date().toISOString() };
};

export function dropPendingOp(dir: string, key: string): void {
  try {
    rmSync(join(dir, `${fileNameOf(key)}.json`), { force: true });
  } catch {
    return;
  }
}

export function hookPendingDir(temporary: string, session: string): string {
  return join(temporary, `tagma-pending-${session}`);
}

function hookOp(stored: Record<string, unknown>): PendingHookWrite | RefusedHookWrite | undefined {
  if (stored.kind !== 'hook-write') return undefined;
  if (typeof stored.path !== 'string' || typeof stored.key !== 'string' || typeof stored.base !== 'string') return undefined;
  if (stored.path === '' || stored.key === '' || stored.base === '') return undefined;
  if (stored.before !== null && typeof stored.before !== 'string') return undefined;
  if (stored.after !== null && typeof stored.after !== 'string') return undefined;
  if (typeof stored.capturedAt !== 'string' || !Number.isFinite(Date.parse(stored.capturedAt))) return undefined;
  if (new Date(stored.capturedAt).toISOString() !== stored.capturedAt) return undefined;
  const op: PendingHookWrite = {
    kind: 'hook-write',
    path: stored.path,
    base: stored.base,
    before: stored.before,
    after: stored.after,
    capturedAt: stored.capturedAt,
    key: stored.key,
  };
  if (stored.refusal === undefined) return op;
  if (!isRecord(stored.refusal) || typeof stored.refusal.code !== 'string' || typeof stored.refusal.reason !== 'string') return undefined;
  return { ...op, refusal: { code: stored.refusal.code, reason: stored.refusal.reason } };
}

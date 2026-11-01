import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import type { Contributed } from '../../platform/contract/wire/contribution.js';
import { ownStoreDirectory } from '../../platform/contract/service/ownStore.js';
import { type Relocated, type Relocation, type RelocationMiss, relocatedPath } from '../../platform/contract/service/relocation.js';
import { lockDataDirectory } from '../../platform/lock/dataDirectory.js';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';
import { chain } from '../../platform/store/chain.js';
import type { Channel } from '../contract/wire/channel.js';
import { DATABASE_FILE, TRANSFER_FILE, dataDirectory } from '../contract/wire/layout.js';
import { moveRows, type RowsMoved } from './rows.js';

export type WorldParts = {
  readonly relocations: readonly Contributed<Relocation>[];
  readonly entities: () => Promise<readonly string[]>;
};

export type CarryMiss = RelocationMiss & { readonly owner: string };

export const unfinishedTransfer = (channel: Channel, env: NodeJS.ProcessEnv): string | null => {
  const at = dataDirectory(channel, env);
  return at !== null && existsSync(join(at, TRANSFER_FILE))
    ? `the transfer into ${at} did not finish; ${channel.command} transfer --from <channel> carries it again`
    : null;
};

export class TransferRefused extends Data.TaggedError('TransferRefused')<{
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
}> {}

export type WorldTransferred = {
  readonly data: Relocated;
  readonly carried: readonly string[];
  readonly rows: readonly RowsMoved[];
  readonly misses: readonly CarryMiss[];
};

const appliedIn = (database: string): readonly string[] => {
  const db = new Database(database, { readonly: true });
  try {
    const ledger = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
    return ledger === null
      ? []
      : db
          .query<{ name: string }, []>('SELECT name FROM __drizzle_migrations')
          .all()
          .map((row) => row.name);
  } finally {
    db.close();
  }
};

const copied = (source: string, target: string): void => {
  const db = new Database(source, { readonly: true });
  try {
    db.run('VACUUM INTO ?', [target]);
  } finally {
    db.close();
  }
};

export const transferWorld = Effect.fnUntraced(function* (
  from: Channel,
  to: Channel,
  env: NodeJS.ProcessEnv,
  parts: WorldParts,
  migrations: string,
): Effect.fn.Return<WorldTransferred, TransferRefused> {
  const source = dataDirectory(from, env);
  const target = dataDirectory(to, env);
  const refuse = (code: string, reason: string, unblock: readonly string[]) => Effect.fail(new TransferRefused({ code, reason, unblock }));
  if (source === null || target === null) return yield* refuse('no-home', 'HOME names no data directory', []);
  if (source === target) return yield* refuse('same-world', `${from.name} and ${to.name} share ${target}`, []);
  if (!existsSync(join(source, DATABASE_FILE))) {
    return yield* refuse('nothing-to-carry', `${source} holds no world of ${from.name}`, []);
  }
  const unfinished = existsSync(join(target, TRANSFER_FILE));
  if (existsSync(join(target, DATABASE_FILE)) && !unfinished) {
    return yield* refuse('world-not-empty', `${target} already holds a world of ${to.name}, and a transfer only fills an empty one`, [
      `move ${target} aside yourself, then transfer again`,
    ]);
  }
  const running = dataDirectoryLocked(target);
  if (running !== null) {
    return yield* refuse(
      'world-held',
      `${running === 'unnamed' ? 'a process' : `pid ${running}`} serves ${target}; the transfer fills it before its server starts`,
      [`end ${running === 'unnamed' ? `the holder of ${target}/server.lock` : `pid ${running}`}, then transfer again`],
    );
  }
  const serving = dataDirectoryLocked(source);
  if (serving !== null) {
    return yield* refuse('source-held', `${from.name} is running on ${source}, and its files are copied only while it stands still`, [
      `close ${from.name}, ${from.command} execution-host shutdown --operation transfer-${randomUUID()}, end its server (pid ${serving === 'unnamed' ? `in ${source}/server.lock` : serving}), then transfer again`,
    ]);
  }
  const ours = new Set(chain({ folder: migrations }).map((migration) => migration.name));
  const applied = yield* Effect.try({
    try: () => appliedIn(join(source, DATABASE_FILE)),
    catch: (cause) =>
      new TransferRefused({ code: 'source-unread', reason: `${join(source, DATABASE_FILE)}: ${String(cause)}`, unblock: [] }),
  });
  const newer = applied.filter((name) => !ours.has(name));
  if (newer.length > 0) {
    return yield* refuse(
      'source-newer',
      `${from.name} has ${newer.length} migrations this ${to.name} does not know (${newer.join(', ')}), and it cannot read that database`,
      [`update ${to.name}, then transfer again`],
    );
  }
  const data = { from: source, to: target };
  const places = [data, ...parts.relocations.flatMap(({ entry }) => entry.beside?.(data) ?? [])];
  mkdirSync(target, { recursive: true });
  const lock = yield* lockDataDirectory(target).pipe(
    Effect.mapError((failure) =>
      failure._tag === 'DataDirectoryConflict'
        ? new TransferRefused({ code: 'world-held', reason: failure.message, unblock: [] })
        : new TransferRefused({ code: 'world-unlocked', reason: `${failure.path}: ${failure.reason}`, unblock: [] }),
    ),
  );
  return yield* Effect.gen(function* () {
    const carried = [
      ownStoreDirectory(join(source, DATABASE_FILE)),
      ...parts.relocations.flatMap(({ entry }) => entry.carried?.(source) ?? []),
    ].filter((path) => existsSync(path));
    yield* Effect.try({
      try: () => {
        writeFileSync(join(target, TRANSFER_FILE), `${JSON.stringify({ from: source, to: target })}\n`);
        for (const path of carried) {
          const into = relocatedPath(path, places);
          if (into === null) continue;
          rmSync(into, { recursive: true, force: true });
          mkdirSync(dirname(into), { recursive: true });
          cpSync(path, into, { recursive: true, verbatimSymlinks: true });
        }
        for (const ending of ['', '-wal', '-shm']) rmSync(join(target, `${DATABASE_FILE}${ending}`), { force: true });
        copied(join(source, DATABASE_FILE), join(target, DATABASE_FILE));
      },
      catch: (cause) => new TransferRefused({ code: 'transfer-failed', reason: String(cause), unblock: [] }),
    });
    const tables = yield* Effect.promise(parts.entities);
    const rows = yield* Effect.try({
      try: () => moveRows(join(target, DATABASE_FILE), tables, places),
      catch: (cause) => new TransferRefused({ code: 'transfer-failed', reason: String(cause), unblock: [] }),
    });
    const misses: CarryMiss[] = [];
    for (const { owner, entry } of parts.relocations) {
      const done = yield* Effect.result(entry.relocate(data, places));
      if (done._tag === 'Success') misses.push(...done.success.map((miss) => ({ ...miss, owner })));
      else misses.push({ owner, path: target, detail: done.failure.detail });
    }
    if (misses.length === 0) rmSync(join(target, TRANSFER_FILE), { force: true });
    return { data, carried, rows, misses } satisfies WorldTransferred;
  }).pipe(Effect.ensuring(lock.release));
});

import { access, readdir, rm, stat } from 'node:fs/promises';
import { rolloutStream } from './rolloutFile.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import {
  cloneFile,
  makeDirectory,
  moveFile,
  removeFile,
  replaceFile,
  type Durability,
  type DurableWriteFailed,
} from '../../platform/durable/files.js';
import { SnapshotFailed, type SnapshotParticipant, type SnapshotScope } from '../../platform/contract/service/snapshots.js';
import { rolloutCut } from './rolloutPins.js';

const relative = Schema.String.check(Schema.isPattern(/^\d+\/[A-Za-z0-9_-]+\.jsonl(?:\.zst)?$/u));
const manifestSchema = Schema.Struct({
  version: Schema.Literal(2),
  cuts: Schema.Array(
    Schema.Struct({
      file: relative,
      generation: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      length: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
      hash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
      fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
    }),
  ),
});

const failed = (path: string, cause: unknown) =>
  new SnapshotFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) });
const disk = <A>(path: string, run: (read: ReadRollout) => Promise<A>): Effect.Effect<A, SnapshotFailed> =>
  Effect.flatMap(RolloutReads, (read) => Effect.tryPromise({ try: () => run(read), catch: (cause) => failed(path, cause) }));
const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return false;
      throw cause;
    },
  );
const rolloutFiles = async (home: string, versions = false): Promise<string[]> => {
  const projects = await readdir(home, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === 'ENOENT') return [];
    throw cause;
  });
  const files: string[] = [];
  for (const project of projects) {
    if (!project.isDirectory() || !/^\d+$/.test(project.name)) continue;
    for (const file of await readdir(join(home, project.name))) {
      const matches = versions
        ? /^[A-Za-z0-9_-]+\.jsonl(?:\.zst)?(?:\.[a-f0-9]{64})?$/.test(file)
        : /^[A-Za-z0-9_-]+\.jsonl(?:\.zst)?$/.test(file);
      if (matches) files.push(`${project.name}/${file}`);
    }
  }
  return files;
};
const threadKey = (file: string): string => file.replace(/\.jsonl(?:\.zst)?(?:\.[a-f0-9]{64})?$/, '');
const fileHash = async (path: string, read: ReadRollout): Promise<string> => {
  const hash = createHash('sha256');
  for await (const bytes of rolloutStream(path, read)) hash.update(bytes);
  return hash.digest('hex');
};
const durable = Effect.fnUntraced(function* (path: string, work: Effect.Effect<Durability, DurableWriteFailed>) {
  const flushed = yield* work.pipe(Effect.mapError((cause) => failed(path, cause.reason)));
  if (flushed !== 'full') return yield* failed(path, 'full flush is unavailable for the rollout snapshot');
});

export function rolloutParticipant(machine: string, home: string): SnapshotParticipant {
  type Cut = (typeof manifestSchema.Type.cuts)[number];
  const prepared = new WeakMap<readonly string[], readonly Cut[]>();
  const cutsOf = Effect.fnUntraced(function* (store: SnapshotScope) {
    if (resolve(store.path) !== resolve(machine)) return [];
    const columns = yield* store.db
      .all<{ name: string }>(sql`select name from pragma_table_info('thread_rollout_cursor')`)
      .pipe(Effect.mapError((cause) => failed(store.path, cause)));
    const rows = columns.some((column) => column.name === 'generation')
      ? yield* store.db
          .all<{ thread: string; generation: number }>(sql`select thread_id as thread, generation from thread_rollout_cursor`)
          .pipe(Effect.mapError((cause) => failed(store.path, cause)))
      : [];
    const generations = new Map(rows.map((row) => [row.thread, row.generation]));
    const files = new Set((yield* disk(home, () => rolloutFiles(home))).sort());
    const cuts: Cut[] = [];
    for (const file of files) {
      if (file.endsWith('.zst') && files.has(file.slice(0, -4))) continue;
      const path = join(home, file);
      const generation = generations.get(threadKey(file).split('/')[1]!) ?? 0;
      const cut = yield* disk(path, (read) => rolloutCut(path, file.endsWith('.zst'), read));
      const fingerprint = yield* disk(path, (read) => fileHash(path, read));
      cuts.push({ file, generation, ...cut, fingerprint });
    }
    return cuts;
  });
  return {
    tables: [
      'thread_event',
      'thread_entry',
      'thread_history_item',
      'thread_log',
      'thread_compaction_checkpoint',
      'thread_pruned_tool_call',
    ],
    estimate: (store) =>
      Effect.tryPromise({
        try: async () => {
          if (resolve(store.path) !== resolve(machine)) return { bytes: 0, hashPasses: 2 };
          const files = new Set(await rolloutFiles(home));
          let bytes = 0;
          for (const file of files) {
            if (file.endsWith('.zst') && files.has(file.slice(0, -4))) continue;
            bytes += (await stat(join(home, file))).size;
          }
          return { bytes, hashPasses: 2 };
        },
        catch: (cause) => failed(home, cause),
      }),
    witness: Effect.fnUntraced(function* (store) {
      const cuts = yield* cutsOf(store);
      prepared.set(store.tables, cuts);
      return createHash('sha256').update(JSON.stringify(cuts)).digest('hex');
    }),
    record: Effect.fnUntraced(function* (store) {
      if (resolve(store.path) !== resolve(machine)) return null;
      const cuts = prepared.get(store.tables) ?? (yield* cutsOf(store));
      prepared.delete(store.tables);
      for (const cut of cuts) {
        const path = join(home, cut.file);
        const pin = join(store.directory, 'rollouts', `${cut.file}.gen-${cut.generation}`);
        yield* durable(pin, cloneFile(path, pin));
        if ((yield* disk(pin, (read) => fileHash(pin, read))) !== cut.fingerprint)
          return yield* failed(path, 'the rollout changed during snapshot capture');
      }
      return { version: 2, cuts };
    }),
    restore: Effect.fnUntraced(function* (store) {
      if (store.record === null) return;
      const manifest = yield* Schema.decodeUnknownEffect(manifestSchema)(store.record).pipe(
        Effect.mapError((cause) => failed(store.path, cause)),
      );
      const byThread = new Map(manifest.cuts.map((cut) => [threadKey(cut.file), cut]));
      const accepted = new Set(store.acceptedLosses);
      for (const key of accepted)
        if (!byThread.has(key)) return yield* failed(store.path, `loss acceptance names no captured rollout: threads:${key}`);
      const cuts: Array<(typeof manifestSchema.Type.cuts)[number]> = [];
      const missing: string[] = [];
      for (const cut of manifest.cuts) {
        const pin = join(store.directory, 'rollouts', `${cut.file}.gen-${cut.generation}`);
        const observed = yield* Effect.result(disk(pin, (read) => fileHash(pin, read)));
        if (observed._tag === 'Success' && observed.success === cut.fingerprint) {
          cuts.push(cut);
          continue;
        }
        const key = threadKey(cut.file);
        const reason = observed._tag === 'Failure' ? observed.failure.reason : 'the pinned rollout does not match its manifest cut';
        if (accepted.has(key)) store.report({ table: 'thread_rollout_cursor', key, reason: `operator accepted lost rollout: ${reason}` });
        else missing.push(`threads:${key} (${reason})`);
      }
      if (missing.length > 0)
        return yield* failed(
          store.path,
          `unrecoverable rollout pins: ${missing.join('; ')}; repair them or repeat restore-snapshot with --accept-loss for each named threads:project/thread`,
        );
      const imported = yield* store.db
        .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'thread_rollout_home'`)
        .pipe(Effect.mapError((cause) => failed(store.path, cause)));
      if (imported.length > 0)
        yield* store.db.run(sql`delete from thread_rollout_home`).pipe(Effect.mapError((cause) => failed(store.path, cause)));
      store.registerPublication(
        Effect.gen(function* () {
          const quarantine = join(store.quarantine, 'rollouts');
          yield* makeDirectory(quarantine).pipe(Effect.mapError((cause) => failed(quarantine, cause.reason)));
          yield* durable(
            quarantine,
            replaceFile(join(quarantine, 'provenance.json'), JSON.stringify({ snapshot: store.snapshot, ...manifest })),
          );
          for (const file of yield* disk(home, () => rolloutFiles(home))) {
            const path = join(home, file);
            const kept = join(quarantine, file);
            yield* makeDirectory(dirname(kept)).pipe(Effect.mapError((cause) => failed(kept, cause.reason)));
            if (yield* disk(kept, () => exists(kept))) {
              const digest = yield* disk(path, (read) => fileHash(path, read));
              const identical = digest === (yield* disk(kept, (read) => fileHash(kept, read)));
              const later = `${kept}.${digest}`;
              const repeated = yield* disk(later, () => exists(later));
              if (repeated && digest !== (yield* disk(later, (read) => fileHash(later, read))))
                return yield* failed(later, 'quarantine bytes disagree with their digest');
              if (identical || repeated) yield* removeFile(path).pipe(Effect.mapError((cause) => failed(path, cause.reason)));
              else yield* durable(path, moveFile(path, later));
            } else yield* durable(path, moveFile(path, kept));
          }
          for (const cut of cuts) {
            const pin = join(store.directory, 'rollouts', `${cut.file}.gen-${cut.generation}`);
            const path = join(home, cut.file);
            const staging = `${path}.restoring-${store.snapshot}`;
            yield* disk(staging, () => rm(staging, { force: true }));
            yield* durable(staging, cloneFile(pin, staging, cut.file.endsWith('.zst') ? undefined : { length: cut.length }));
            yield* durable(path, moveFile(staging, path));
          }
          for (const file of yield* disk(quarantine, () => rolloutFiles(quarantine, true))) {
            const captured = byThread.get(threadKey(file));
            store.report({
              table: 'thread_rollout_cursor',
              key: threadKey(file),
              reason:
                captured === undefined
                  ? `post-snapshot rollout ${file} remains quarantined`
                  : `rollout ${file} is preserved in quarantine; the snapshot cut names generation ${captured.generation} at ${captured.length} bytes`,
            });
          }
        }),
      );
    }),
  };
}

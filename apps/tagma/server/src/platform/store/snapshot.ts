import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { Effect, Schema, Semaphore } from 'effect';
import { makeDirectory, requireSpace } from '../durable/files.js';
import { dataSpaceWords } from '../durable/space.js';
import {
  type SnapshotParticipant,
  SnapshotFailed,
  type SnapshotStore,
  type SnapshotLoss,
  StoreSnapshots,
} from '../contract/service/snapshots.js';
import {
  cloneStore,
  flushFile,
  snapshotDigest,
  snapshotDocument,
  snapshotFile,
  snapshotIO,
  snapshotPaths,
  syncDirectory,
} from './snapshotFiles.js';
import { copyTables, restoreTables } from './snapshotCopies.js';
import { restoreSpace, snapshotReading } from './snapshotPlan.js';
import { snapshotLosses } from './snapshotLosses.js';
import { migrationLoad } from './migrationLoad.js';
import { captureKeys, checkKeys, foreignKeys } from './keyCheck.js';
import { reusableCut, snapshotRetention } from './snapshotPolicy.js';

const boot = randomUUID();
const identity = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/u));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const manifestSchema = Schema.Struct({
  format: Schema.Literal('tagma.snapshot'),
  version: Schema.Literal(2),
  id: identity,
  store: Schema.String,
  pending: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
  tables: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      definition: Schema.NullOr(Schema.String),
      columns: Schema.Array(Schema.String),
      rowid: Schema.NullOr(Schema.String),
      savedRowid: Schema.NullOr(Schema.String),
      data: Schema.Boolean,
      added: Schema.Array(Schema.String),
      sequence: Schema.NullOr(Schema.String),
      renamed: Schema.optional(Schema.String),
    }),
  ),
  objects: Schema.Array(
    Schema.Struct({ type: Schema.Literals(['index', 'trigger', 'view']), name: Schema.String, definition: Schema.NullOr(Schema.String) }),
  ),
  rebuilt: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  rows: Schema.Record(Schema.String, Schema.Number),
  bytes: Schema.Number,
  source: digest,
  digest,
  participants: Schema.Record(Schema.String, Schema.Unknown),
  completed: Schema.optional(identity),
  restoration: Schema.optional(identity),
  acceptedLosses: Schema.optional(Schema.Array(Schema.String)),
});

type SnapshotManifest = typeof manifestSchema.Type;

const failure = (path: string, cause: unknown): SnapshotFailed =>
  cause instanceof SnapshotFailed ? cause : new SnapshotFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) });

const readManifest = Effect.fnUntraced(function* (path: string) {
  const text = yield* snapshotIO(path, () =>
    readFile(path, 'utf8').catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return null;
      throw cause;
    }),
  );
  if (text === null) return null;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(manifestSchema))(text).pipe(
    Effect.mapError(
      () =>
        new SnapshotFailed({
          path,
          reason:
            'snapshot metadata is unreadable or is from the earlier whole-store format; restore it with the build that created it before upgrading',
        }),
    ),
  );
});

const checkpoint = Effect.fnUntraced(function* (store: SnapshotStore) {
  const rows = yield* store.db
    .all<{ busy: number }>(sql`PRAGMA wal_checkpoint(TRUNCATE)`)
    .pipe(Effect.mapError((cause) => failure(store.path, cause)));
  if (rows.length !== 1 || rows[0]!.busy !== 0)
    return yield* new SnapshotFailed({ path: store.path, reason: 'snapshot checkpoint is busy' });
});

export const refuseRestore = Effect.fnUntraced(function* (path: string) {
  const pending = yield* readManifest(snapshotPaths(path).intent);
  if (pending !== null)
    return yield* new SnapshotFailed({
      path,
      reason: `snapshot ${pending.id} is being restored; finish tagma db restore-snapshot before opening this store`,
    });
});

const sweepFiles = Effect.fnUntraced(function* (path: string) {
  yield* refuseRestore(path);
  const paths = snapshotPaths(path);
  const current = yield* readManifest(paths.current);
  const entries = yield* snapshotIO(paths.root, () =>
    readdir(paths.root, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return [];
      throw cause;
    }),
  );
  for (const entry of entries) {
    if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name) && entry.name !== current?.id)
      yield* snapshotIO(path, () => rm(join(paths.root, entry.name), { recursive: true, force: true }));
  }
  for (const suffix of ['', '-wal', '-shm']) yield* snapshotIO(path, () => rm(`${paths.staging}${suffix}`, { force: true }));
  for (const name of yield* snapshotIO(path, () => readdir(dirname(path)))) {
    for (const document of [paths.current, paths.intent]) {
      const prefix = `${basename(document)}.`;
      if (name.startsWith(prefix) && /^\d+\.[a-z0-9]*\.tmp$/.test(name.slice(prefix.length)))
        yield* snapshotIO(path, () => rm(join(dirname(path), name), { force: true }));
    }
  }
});

export const restoreParticipantInto = Effect.fnUntraced(function* (owner: string, participant: SnapshotParticipant, snapshot: string) {
  const standing = yield* Effect.tryPromise({
    try: () => stat(snapshot),
    catch: (cause) => new SnapshotFailed({ path: snapshot, reason: `the snapshot copy cannot be read: ${String(cause)}` }),
  });
  if (!standing.isFile()) return yield* new SnapshotFailed({ path: snapshot, reason: 'the snapshot copy is not a file' });
  const restore = participant.restore;
  const losses: SnapshotLoss[] = [];
  if (restore === undefined) return losses;
  yield* Effect.gen(function* () {
    const db = yield* makeWithDefaults();
    yield* restore({
      path: snapshot,
      db,
      tables: participant.tables,
      snapshot,
      directory: dirname(snapshot),
      quarantine: dirname(snapshot),
      record: undefined,
      acceptedLosses: [],
      registerPublication: () => undefined,
      report: (loss) => {
        losses.push({ owner, ...loss });
      },
    });
  }).pipe(
    Effect.provide(
      sqliteProcessLayer({
        filename: snapshot,
        readers: 0,
        onLost: (reason) => console.error(`[tagma] snapshot copy connection lost: ${reason}`),
      }),
    ),
  );
  return losses;
});

export function storeSnapshots(participants: Readonly<Record<string, SnapshotParticipant>>): StoreSnapshots['Service'] {
  const registered = Object.entries(participants);
  const retire = new Map<string, string>();
  const locks = new Map<string, Semaphore.Semaphore>();
  let admitted = false;
  const exclusive = <A, E>(path: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      const lock = locks.get(path) ?? Semaphore.makeUnsafe(1);
      locks.set(path, lock);
      return lock.withPermit(Effect.uninterruptible(work));
    });
  const checkParticipants = (manifest: SnapshotManifest): Effect.Effect<void, SnapshotFailed> => {
    const absent = Object.keys(manifest.participants).filter((owner) => participants[owner] === undefined);
    return absent.length === 0
      ? Effect.void
      : Effect.fail(new SnapshotFailed({ path: manifest.store, reason: `snapshot participants are missing: ${absent.join(', ')}` }));
  };
  const drop = Effect.fn('StoreSnapshots.release')(function* (path: string, migrations?: readonly string[]) {
    const paths = snapshotPaths(path);
    yield* refuseRestore(path);
    const manifest = yield* readManifest(paths.current);
    const selected = migrations === undefined ? undefined : new Set(migrations);
    if (manifest === null || (selected !== undefined && !manifest.pending.some(({ name }) => selected.has(name)))) return [];
    yield* snapshotIO(path, () => rm(paths.current));
    yield* syncDirectory(dirname(path));
    yield* snapshotIO(path, () => rm(paths.root, { recursive: true, force: true }));
    yield* syncDirectory(dirname(path));
    retire.delete(path);
    return [manifest.id];
  }, Effect.uninterruptible);
  const release = (named: string, migrations?: readonly string[]) => exclusive(resolve(named), drop(resolve(named), migrations));
  const retireQueued = (queued: readonly (readonly [string, string])[]) =>
    Effect.forEach(queued, ([path, id]) =>
      Effect.gen(function* () {
        if (retire.get(path) !== id) return;
        const current = yield* readManifest(snapshotPaths(path).current);
        if (current?.id === id && snapshotRetention(current.completed, boot, true, admitted) === 'release') yield* drop(path);
        retire.delete(path);
      }).pipe((work) => exclusive(path, work)),
    );
  return StoreSnapshots.of({
    estimate: (store, pending, folder) => migrationLoad(store, pending, folder, participants),
    standing: (path) => Effect.map(readManifest(snapshotPaths(resolve(path)).current), (manifest) => manifest !== null),
    covers: Effect.fnUntraced(function* (path, table) {
      const paths = snapshotPaths(resolve(path));
      const manifest = (yield* readManifest(paths.intent)) ?? (yield* readManifest(paths.current));
      return (
        manifest !== null &&
        manifest.tables.some(
          (held) => held.name.toLowerCase() === table.toLowerCase() || held.renamed?.toLowerCase() === table.toLowerCase(),
        )
      );
    }),
    release,
    sweep: (named) => exclusive(resolve(named), sweepFiles(resolve(named))),
    ready: Effect.suspend(() => {
      admitted = true;
      return retireQueued([...retire]);
    }),
    opened: Effect.fn('StoreSnapshots.opened')(
      function* (store) {
        if (store.path === ':memory:') return;
        const path = resolve(store.path);
        const paths = snapshotPaths(path);
        const current = yield* readManifest(paths.current);
        if (current === null) return;
        const columns = yield* store.db.all<{ name: string }>(sql`select name from pragma_table_info('__drizzle_migrations')`);
        if (!columns.some((column) => column.name === 'hash')) return;
        const named = columns.some((column) => column.name === 'name');
        const applied = new Map(
          (yield* store.db.all<{ name: string; hash: string }>(
            named ? sql`select name, hash from __drizzle_migrations` : sql`select hash as name, hash from __drizzle_migrations`,
          )).map((row) => [row.name, row.hash]),
        );
        const action = snapshotRetention(
          current.completed,
          boot,
          current.pending.every((migration) => applied.get(named ? migration.name : migration.hash) === migration.hash),
          admitted,
        );
        if (action === 'complete') yield* snapshotDocument(paths.current, { ...current, completed: boot });
        else if (action === 'queue') retire.set(path, current.id);
        else if (action === 'release') yield* drop(path);
      },
      (effect, store) =>
        effect.pipe(
          Effect.mapError((cause) => failure(store.path, cause)),
          (work) => exclusive(resolve(store.path), work),
        ),
    ),
    take: Effect.fn('StoreSnapshots.take')(
      function* (store, pending) {
        if (pending.length === 0 || store.path === ':memory:') return;
        const path = resolve(store.path);
        yield* refuseRestore(path);
        const paths = snapshotPaths(path);
        const previous = yield* readManifest(paths.current);
        const reading = yield* store.db.transaction(() => snapshotReading(store.db, path, pending));
        const tables = reading.plan.tables.filter((table) => table.data).map((table) => table.name);
        const scoped = { ...store, tables };
        const active = registered.filter(([, participant]) => participant.tables.some((table) => tables.includes(table)));
        const witnesses: Record<string, string> = {};
        for (const [owner, participant] of active)
          if (participant.witness !== undefined) witnesses[owner] = yield* participant.witness(scoped);
        const source = createHash('sha256').update(reading.hash).update(JSON.stringify(witnesses)).digest('hex');
        if (previous !== null && reusableCut(previous, { source, pending })) {
          yield* checkParticipants(previous);
          if ((yield* snapshotDigest(snapshotFile(path, previous.id))) !== previous.digest)
            return yield* new SnapshotFailed({ path, reason: 'the standing snapshot changed; repair it before migrating' });
          if (previous.completed !== undefined) yield* snapshotDocument(paths.current, { ...previous, completed: undefined });
          retire.delete(path);
          return;
        }
        yield* requireSpace(path, 2 * reading.bytes).pipe(
          Effect.mapError(
            (cause) =>
              new SnapshotFailed({
                path,
                reason: cause.reason,
                words: dataSpaceWords(2 * reading.bytes),
              }),
          ),
        );
        for (const [, participant] of active) if (participant.prepare !== undefined) yield* participant.prepare(scoped);
        const id = randomUUID();
        const directory = join(paths.root, id);
        yield* makeDirectory(directory).pipe(Effect.mapError((cause) => failure(path, cause.reason)));
        const manifest = yield* Effect.gen(function* () {
          const parts: Record<string, unknown> = {};
          for (const [owner, participant] of active)
            parts[owner] = participant.record === undefined ? null : yield* participant.record({ ...scoped, snapshot: id, directory });
          const copied = snapshotFile(path, id);
          yield* snapshotIO(copied, async () => {
            const file = await open(copied, 'wx', 0o600);
            await file.close();
          });
          yield* store.db.run(sql`ATTACH DATABASE ${copied} AS snapshot`);
          yield* Effect.gen(function* () {
            yield* store.db.run(sql`PRAGMA snapshot.journal_mode = DELETE`);
            yield* store.db.transaction(() =>
              Effect.gen(function* () {
                const [now] = yield* store.db.all<{ changes: number; version: number; schema: number }>(
                  sql`select total_changes() as changes, data_version as version, schema_version as schema from pragma_data_version, pragma_schema_version`,
                );
                if (JSON.stringify(now) !== JSON.stringify(reading.epoch))
                  return yield* new SnapshotFailed({ path, reason: 'the source changed while its snapshot was prepared; retry capture' });
                yield* copyTables(store.db, reading.plan.tables);
              }),
            );
          }).pipe(Effect.ensuring(store.db.run(sql`DETACH DATABASE snapshot`).pipe(Effect.orDie)));
          const scrubbers = active.flatMap(([, participant]) => (participant.scrub === undefined ? [] : [participant.scrub]));
          if (scrubbers.length > 0)
            yield* Effect.gen(function* () {
              const db = yield* makeWithDefaults();
              for (const scrub of scrubbers) yield* scrub({ path: copied, db, tables });
              yield* checkpoint({ path: copied, db });
            }).pipe(
              Effect.provide(
                sqliteProcessLayer({
                  filename: copied,
                  readers: 0,
                  onLost: (reason) => console.error(`[tagma] snapshot scrub connection lost: ${reason}`),
                }),
              ),
            );
          yield* flushFile(copied);
          const manifest: SnapshotManifest = {
            format: 'tagma.snapshot',
            version: 2,
            id,
            store: path,
            pending: pending.map(({ name, hash }) => ({ name, hash })),
            tables: reading.plan.tables,
            objects: reading.plan.objects,
            rebuilt: reading.plan.rebuilt,
            rows: reading.rows,
            bytes: reading.bytes,
            source,
            digest: yield* snapshotDigest(copied),
            participants: parts,
          };
          yield* snapshotDocument(join(directory, 'manifest.json'), manifest);
          yield* syncDirectory(paths.root);
          return manifest;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* snapshotIO(directory, () => rm(directory, { recursive: true, force: true }));
              yield* syncDirectory(paths.root);
              return yield* Effect.failCause(cause);
            }),
          ),
        );
        yield* snapshotDocument(paths.current, manifest);
        if (previous !== null) yield* snapshotIO(path, () => rm(join(paths.root, previous.id), { recursive: true, force: true }));
        console.log(
          `[tagma] snapshot ${id}: ${tables.length} data tables, ${reading.plan.tables.length - tables.length} schema-only targets`,
        );
      },
      (effect, store, pending) =>
        effect.pipe(
          Effect.mapError((cause) => failure(store.path, cause)),
          Effect.uninterruptible,
          (work) => exclusive(resolve(store.path), work),
        ),
    ),
    restore: Effect.fn('StoreSnapshots.restore')(
      function* (named, options) {
        const path = resolve(named);
        const paths = snapshotPaths(path);
        const intent = yield* readManifest(paths.intent);
        const manifest = intent ?? (yield* readManifest(paths.current));
        if (manifest === null) return yield* new SnapshotFailed({ path, reason: 'no pre-migration snapshot stands' });
        if (manifest.store !== path) return yield* new SnapshotFailed({ path, reason: 'the snapshot belongs to another store' });
        yield* checkParticipants(manifest);
        if (intent !== null && intent.restoration === undefined)
          return yield* new SnapshotFailed({ path, reason: 'the restore intent has no identity' });
        const captured = snapshotFile(path, manifest.id);
        if ((yield* snapshotDigest(captured)) !== manifest.digest)
          return yield* new SnapshotFailed({ path, reason: 'the captured tables disagree with their snapshot digest' });
        const restoration = intent?.restoration ?? randomUUID();
        const quarantine = join(`${path}.snapshot-quarantine`, restoration);
        const acceptedLosses = [...new Set([...(intent?.acceptedLosses ?? []), ...(options?.acceptLoss ?? [])])];
        for (const key of acceptedLosses) {
          if (!Object.keys(manifest.participants).some((owner) => key.startsWith(`${owner}:`) && key.length > owner.length + 1))
            return yield* new SnapshotFailed({ path, reason: `loss acceptance names no snapshot participant: ${key}` });
        }
        const losses: SnapshotLoss[] = [];
        const publications: Effect.Effect<void, SnapshotFailed>[] = [];
        const tables = manifest.tables.filter((table) => table.data).map((table) => table.name);
        yield* snapshotIO(path, async () => {
          for (const suffix of ['', '-wal', '-shm']) await rm(`${paths.staging}${suffix}`, { force: true });
        });
        yield* requireSpace(path, 2 * manifest.bytes).pipe(Effect.mapError((cause) => failure(path, cause.reason)));
        yield* cloneStore(captured, paths.staging);
        yield* Effect.gen(function* () {
          const db = yield* makeWithDefaults();
          for (const [owner, record] of Object.entries(manifest.participants)) {
            const participant = participants[owner]!;
            if (participant.restore !== undefined)
              yield* participant.restore({
                path,
                db,
                tables,
                snapshot: manifest.id,
                directory: join(paths.root, manifest.id),
                quarantine,
                record,
                registerPublication: (work) => publications.push(work),
                acceptedLosses: acceptedLosses.filter((key) => key.startsWith(`${owner}:`)).map((key) => key.slice(owner.length + 1)),
                report: (loss) => losses.push({ owner, ...loss }),
              });
          }
          yield* checkpoint({ path: paths.staging, db });
        }).pipe(
          Effect.provide(
            sqliteProcessLayer({
              filename: paths.staging,
              readers: 0,
              onLost: (reason) => console.error(`[tagma] snapshot staging connection lost: ${reason}`),
            }),
          ),
        );
        yield* flushFile(paths.staging);
        const current = yield* snapshotIO(path, () => stat(path));
        if (!current.isFile())
          return yield* new SnapshotFailed({
            path,
            reason: 'table-scoped restore requires the original store file; it does not reconstruct unrelated tables',
          });
        yield* Effect.gen(function* () {
          const db = yield* makeWithDefaults();
          yield* db.run(sql`PRAGMA foreign_keys = OFF`);
          yield* db.run(sql`ATTACH DATABASE ${paths.staging} AS snapshot`);
          const currentBytes = yield* restoreSpace(db, path, manifest.tables);
          yield* requireSpace(path, 2 * (currentBytes + manifest.bytes)).pipe(Effect.mapError((cause) => failure(path, cause.reason)));
          const touched = new Set(
            manifest.tables.filter((table) => table.data || table.definition === null).map((table) => table.name.toLowerCase()),
          );
          yield* db.transaction(() =>
            Effect.gen(function* () {
              const rowLosses = yield* snapshotLosses(db, path, manifest.tables, manifest.rows).pipe(
                Effect.catchCause(() =>
                  Effect.succeed([
                    {
                      owner: 'platform',
                      table: '*',
                      key: 'unmeasured',
                      reason: 'current row counts could not be read; field-value changes are not compared',
                    },
                  ]),
                ),
              );
              losses.push(...rowLosses);
              const existed = new Set(
                (yield* db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)).map((row) =>
                  row.name.toLowerCase(),
                ),
              );
              const captures = yield* captureKeys(
                db,
                (yield* foreignKeys(db)).filter((key) => touched.has(key.parent.toLowerCase()) && existed.has(key.parent.toLowerCase())),
              );
              yield* restoreTables(db, manifest.tables, manifest.objects, manifest.rebuilt);
              const checked = yield* checkKeys(db, captures, {
                existed,
                touched,
                rekeyed: new Map(),
                restored: touched,
                added: [],
                written: [],
                moved: 1,
                keys: yield* foreignKeys(db),
              });
              if (checked.dangling.length > 0)
                return yield* new SnapshotFailed({
                  path,
                  reason: 'restoring these tables would leave dangling references in current rows; no table restore was committed',
                });
              for (const scan of checked.scans)
                console.warn(
                  `[tagma] snapshot reference check scanned ${scan.table} in ${scan.ms} ms; its foreign key has no covering index`,
                );
              yield* snapshotDocument(paths.intent, { ...manifest, restoration, acceptedLosses });
              yield* makeDirectory(quarantine).pipe(Effect.mapError((cause) => failure(path, cause.reason)));
              for (const publish of publications) yield* publish;
              yield* snapshotDocument(join(quarantine, 'report.json'), { snapshot: manifest.id, losses });
            }),
          );
          yield* db.run(sql`DETACH DATABASE snapshot`);
          yield* checkpoint({ path, db });
        }).pipe(
          Effect.provide(
            sqliteProcessLayer({
              filename: path,
              readers: 0,
              synchronous: 'full',
              fullfsync: process.platform === 'darwin',
              onLost: (reason) => console.error(`[tagma] snapshot restore connection lost: ${reason}`),
            }),
          ),
        );
        yield* flushFile(path);
        yield* snapshotDocument(paths.current, { ...manifest, completed: undefined, restoration: undefined, acceptedLosses: undefined });
        retire.delete(path);
        yield* snapshotIO(path, async () => {
          for (const suffix of ['', '-wal', '-shm']) await rm(`${paths.staging}${suffix}`, { force: true });
          await rm(paths.intent);
        });
        yield* syncDirectory(dirname(path));
        return { snapshot: manifest.id, quarantine, losses };
      },
      (effect, named, options) =>
        effect.pipe(
          Effect.mapError((cause) => failure(named, cause)),
          Effect.uninterruptible,
          (work) => exclusive(resolve(named), work),
        ),
    ),
  });
}

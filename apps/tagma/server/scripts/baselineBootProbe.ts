import { constants } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Context, Effect, Layer, Tracer } from 'effect';
import { sql } from 'drizzle-orm';
import { MachineStore } from '../src/platform/contract/service/store.js';
import { StoreOpening, type OpeningStep } from '../src/platform/contract/service/opening.js';
import { storeLayer } from '../src/platform/store/open.js';
import { migrationsFolder } from '../src/installation/closure/read.js';
import { storeSnapshots } from '../src/platform/store/snapshot.js';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';

const profiles: Promise<number | null>[] = [];
const channels: { event: string; at: number; pid: number; ask?: unknown; said?: unknown }[] = [];
class TracedProcesses extends ProcessPool {
  override connect(...[lane, receive, lost, spawned]: Parameters<ProcessPool['connect']>): ReturnType<ProcessPool['connect']> {
    let closing: number | undefined;
    const channel = super.connect(
      lane,
      (said) => {
        if (said.id === closing) channels.push({ event: 'close.reply', at: Date.now(), pid: channel.pid, said });
        receive(said);
      },
      lost,
      spawned,
    );
    return {
      ...channel,
      send: (ask) => {
        if (ask._tag === 'Close') {
          closing = ask.id;
          channels.push({ event: 'close.send', at: Date.now(), pid: channel.pid, ask });
        }
        channel.send(ask);
        if (ask._tag === 'Close' && samplePath) {
          const sample = spawn('sample', [String(channel.pid), '2', '-file', samplePath], { stdio: 'inherit' });
          profiles.push(
            new Promise<number | null>((resolve, reject) => {
              sample.once('error', reject);
              sample.once('exit', resolve);
            }),
          );
        }
      },
      release: async () => {
        channels.push({ event: 'release.start', at: Date.now(), pid: channel.pid });
        try {
          await channel.release();
        } finally {
          channels.push({ event: 'release.done', at: Date.now(), pid: channel.pid });
        }
      },
      retire: async () => {
        channels.push({ event: 'retire.start', at: Date.now(), pid: channel.pid });
        try {
          await channel.retire();
        } finally {
          channels.push({ event: 'retire.done', at: Date.now(), pid: channel.pid });
        }
      },
    };
  }
}

const sizeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size;
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
    return null;
  }
};

const [source, given, samplePath] = process.argv.slice(2);
if (!source || !given) throw new Error('Usage: bun scripts/baselineBootProbe.ts <operator database> <new clone directory>');
const root = resolve(given);
await mkdir(root, { recursive: true });
const path = join(root, 'tagma.sqlite');
const reader = spawn('sqlite3', ['-readonly', '-batch', source], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
reader.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});
const ended = new Promise<number | null>((resolve, reject) => {
  reader.once('error', reject);
  reader.once('exit', resolve);
});
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`The readonly metadata lease did not answer: ${stderr}`)), 10_000);
    let stdout = '';
    const answer = (chunk: Buffer) => {
      stdout += String(chunk);
      if (!stdout.includes('lease:')) return;
      clearTimeout(timeout);
      reader.stdout.off('data', answer);
      resolve();
    };
    reader.stdout.on('data', answer);
    reader.stdin.write(".bail on\nBEGIN;\nSELECT 'lease:' || count(*) FROM sqlite_master;\n");
    ended.then((code) => {
      clearTimeout(timeout);
      reject(new Error(`Readonly lease ended (${code}): ${stderr}`));
    }, reject);
  });
  await copyFile(source, path, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
  try {
    await stat(`${source}-wal`);
    await copyFile(`${source}-wal`, `${path}-wal`, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
  }
} finally {
  reader.stdin.end('COMMIT;\n.quit\n');
  const code = await ended;
  if (code !== 0) throw new Error(`Readonly metadata lease failed (${code}): ${stderr}`);
}
const before = { databaseBytes: await sizeOf(path), walBytes: await sizeOf(`${path}-wal`), shmBytes: await sizeOf(`${path}-shm`) };
const steps: OpeningStep[] = [];
const spans: Tracer.NativeSpan[] = [];
const tracer = Tracer.make({
  span(options) {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  },
});
const processes = new TracedProcesses(0, 'stop', undefined, childHosting);
const snapshots = storeSnapshots({}, processes);
const tracedSnapshots = {
  ...snapshots,
  take: (store: Parameters<typeof snapshots.take>[0], pending: Parameters<typeof snapshots.take>[1]) =>
    snapshots.take(store, pending).pipe(Effect.withSpan('snapshot.take')),
};
const started = performance.now();
const result = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        storeLayer(
          MachineStore,
          path,
          { folder: migrationsFolder, seeds: join(root, 'seeds'), snapshots: tracedSnapshots },
          { readers: 0 },
          processes,
        ),
      );
      const store = Context.get(context, MachineStore);
      const openedMs = performance.now() - started;
      const ledger = yield* store.db.all<{ name: string; hash: string }>(
        sql`select name, hash from __drizzle_migrations order by created_at, id`,
      );
      const state = {
        path,
        openedMs,
        schema: store.schema,
        ledger,
        steps,
        before,
        beforeCloseWalBytes: yield* Effect.promise(() => sizeOf(`${path}-wal`)),
        cache: 'fresh APFS clone and new SQLite connection; OS page cache uncontrolled',
      };
      yield* Effect.promise(() => writeFile(join(root, 'opening.json'), `${JSON.stringify(state, null, 2)}\n`));
      console.log(JSON.stringify(state));
      return state;
    }),
  ).pipe(
    Effect.provideService(StoreOpening, (step) =>
      Effect.sync(() => {
        steps.push(step);
      }),
    ),
    Effect.withTracer(tracer),
  ),
);
const sampleExits = await Promise.all(profiles);
if (sampleExits.some((code) => code !== 0)) process.exitCode = 1;
const trace = spans.flatMap((span) =>
  span.status._tag === 'Ended'
    ? [
        {
          name: span.name,
          startMs: Number(span.status.startTime) / 1_000_000,
          durationMs: Number(span.status.endTime - span.status.startTime) / 1_000_000,
          attributes: Object.fromEntries(span.attributes),
        },
      ]
    : [],
);
await writeFile(
  join(root, 'trace.json'),
  `${JSON.stringify({ ...result, afterCloseWalBytes: await sizeOf(`${path}-wal`), afterCloseShmBytes: await sizeOf(`${path}-shm`), channels, sampleExits, trace }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    completed: true,
    openedMs: result.openedMs,
    channels,
    slowest: trace.toSorted((a, b) => b.durationMs - a.durationMs).slice(0, 8),
  }),
);

import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Clock, Context, Effect, Layer } from 'effect';
import { activity } from '../Activity';
import { ActivityLog } from '../log';
import { MODEL_CALL } from '../modelCall';
import { ActivityStore, activityStoreLayer } from './ActivityStore';
import { ActivityRecord } from './record';

it.live('opening the folded activity chain recreates its bounded history once and preserves subsequent records', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-baseline-'))),
      (at) => Effect.sync(() => rmSync(at, { recursive: true, force: true })),
    );
    const database = join(root, 'activity.sqlite');
    const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const config = {
      database,
      migrations,
      processes: yield* heldPool,
      bodies: join(root, 'bodies'),
      keeping: () => ({ hours: 24, bodiesMaxBytes: 1024 * 1024 }),
      projectsOf: (threads: readonly string[]) => Effect.succeed(new Map(threads.map((id) => [id, 7]))),
    };
    const open = Layer.build(activityStoreLayer(config));
    const recorded = (log: ActivityLog) =>
      activity(MODEL_CALL, { provider: 'probe', model: 'probe', rung: 'high' }, Effect.void, { thread: 'thread' }).pipe(
        Effect.provideService(ActivityLog, log),
      );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const store = Context.get(yield* open, ActivityStore);
        yield* recorded(store.log);
        yield* store.settled;
      }),
    );
    const receipt = JSON.parse(readFileSync(join(migrations, 'baseline.json'), 'utf8')) as { chain: { name: string; hash: string }[] };
    const db = new Database(database);
    try {
      db.exec('delete from __drizzle_migrations');
      const insert = db.query('insert into __drizzle_migrations (name, hash, created_at) values (?, ?, ?)');
      for (const [at, row] of receipt.chain.entries()) insert.run(row.name, row.hash, at);
    } finally {
      db.close();
    }
    mkdirSync(config.bodies, { recursive: true });
    const obsolete = join(config.bodies, 'unreferenced.json');
    writeFileSync(obsolete, 'stored body');
    const scope = { project: 7, through: yield* Clock.currentTimeMillis, where: [], limit: 10, paths: ['id'] } as const;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const current = yield* open;
        const healthy = Context.get(current, ActivityStore);
        expect((yield* healthy.health).state).toBe('live');
        expect((yield* Context.get(current, ActivityRecord).rows(scope)).rows).toHaveLength(0);
        expect(existsSync(obsolete)).toBe(false);
        yield* recorded(healthy.log);
        yield* healthy.settled;
      }),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const latest = Context.get(yield* open, ActivityRecord);
        expect((yield* latest.rows({ ...scope, through: yield* Clock.currentTimeMillis })).rows).toHaveLength(1);
      }),
    );
  }),
);

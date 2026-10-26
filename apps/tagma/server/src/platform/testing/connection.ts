import { makeWithDefaults, type EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

export const storePlace = Effect.fnUntraced(function* (prefix: string) {
  const files = yield* FileSystem.FileSystem;
  return join(yield* files.makeTempDirectoryScoped({ prefix }), 'store.sqlite');
});

export const inDatabase = <A, E>(path: string, body: (db: EffectSQLiteBunDatabase) => Effect.Effect<A, E>) =>
  Effect.flatMap(sharedPool, (pool) =>
    Effect.flatMap(makeWithDefaults(), body).pipe(
      Effect.provide(
        sqliteProcessLayer(
          {
            filename: path,
            readers: 0,
            onLost: (reason) => {
              throw new Error(reason);
            },
          },
          pool,
        ),
      ),
    ),
  );

export const withDatabase = <A, E>(path: string, body: (db: EffectSQLiteBunDatabase) => Effect.Effect<A, E>) =>
  Effect.runPromise(inDatabase(path, body));

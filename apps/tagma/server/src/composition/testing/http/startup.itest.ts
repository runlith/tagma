import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join, resolve } from 'node:path';
import { serverProcessesLayer } from '../../children.js';
import { Clock, Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Scope } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { FetchHttpClient, HttpBody, HttpClient, HttpClientResponse, HttpRouter, HttpServer, HttpServerResponse } from 'effect/http';
import { sql } from 'drizzle-orm';
import { MachineStore, type MigrationChain } from '../../../platform/contract/service/store.js';
import { StoreOpening } from '../../../platform/contract/service/opening.js';
import { storeLayer } from '../../../platform/store/open.js';
import { inDatabase } from '../../../platform/testing/connection.js';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { makeProcessRestart, readStartup } from '../../../installation/process/record.js';
import { startupStateSchema } from '../../../installation/contract/wire/restart.js';
import { startingHandler } from '../../../http/starting.js';
import { unreadyHealthSchema } from '../../../http/contract/wire/health.js';
import { OUTCOME_HEADER } from '../../../invocation/contract/wire/headers.js';
import { localGate } from '../../http/local.js';

it.live('a pending migration is visible while health and operations refuse, then the same listener serves the opened store', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const client = yield* HttpClient.HttpClient;
    const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'tagma-startup-' }));
    const folder = join(home, 'migrations');
    const name = '20260101000000_start';
    yield* files.makeDirectory(join(folder, name), { recursive: true });
    yield* files.writeFileString(join(folder, name, 'migration.sql'), 'CREATE TABLE opened (id integer);');
    const path = join(home, 'machine.sqlite');
    yield* inDatabase(path, (db) => db.run(sql`PRAGMA user_version = 0`));
    yield* files.writeFileString(join(home, 'index.html'), '<!doctype html><title>surface</title>');
    yield* files.makeDirectory(join(home, '_app'), { recursive: true });
    yield* files.writeFileString(join(home, '_app', 'version.json'), '{"version":"first"}');
    const records = yield* makeProcessRestart({ path: join(home, 'restart.json'), pid: process.pid });
    records.start(yield* Clock.currentTimeMillis);
    const context = yield* Layer.build(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' }));
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (address._tag === 'UnixPathAddress') return yield* Effect.die('the local listener has no internet address');
    const url = `http://127.0.0.1:${address.port}`;
    const get = (path: string, headers?: Record<string, string>) => client.get(`${url}${path}`, { headers });
    const lifetime = yield* Effect.scope;
    const starting = yield* Scope.fork(lifetime);
    const active = yield* Scope.fork(lifetime);
    const handler = yield* Effect.provide(startingHandler(records, home), context);
    yield* Effect.provide(Scope.provide(HttpServer.serveEffect(handler, localGate([])), starting), context);
    const entered = yield* Deferred.make<void>();
    const proceed = yield* Deferred.make<void>();
    const migrations: MigrationChain<'machine'> = { folder, seeds: join(home, 'seeds') };
    const opening = yield* Effect.forkScoped(
      Layer.build(
        storeLayer(MachineStore, path, migrations, { readers: 0 }, yield* sharedPool).pipe(
          Layer.provide(
            Layer.succeed(StoreOpening, (step) =>
              Effect.gen(function* () {
                records.opening(step);
                if (step.phase !== 'migration') return;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(proceed);
              }),
            ),
          ),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      yield* Deferred.await(entered);
      const status = yield* get('/startup').pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(startupStateSchema)));
      expect(status.startup).toMatchObject({ status: 'starting', step: { name, index: 1, total: 1 }, failure: null });
      const health = yield* get('/health');
      expect(health.status).toBe(503);
      expect((yield* HttpClientResponse.schemaBodyJson(unreadyHealthSchema)(health)).ok).toBe(false);
      const operation = yield* client.post(`${url}/api/op/read_machine_state`, { body: HttpBody.text('{}') });
      expect(operation.status).toBe(503);
      expect(operation.headers[OUTCOME_HEADER]).toBe('refusal');
      expect(yield* operation.json).toMatchObject({ code: 'server-starting' });
      const shell = yield* get('/project/chat', { accept: 'text/html' });
      expect([shell.status, shell.headers['cache-control']]).toEqual([200, 'no-cache']);
      expect(yield* shell.text).toContain('<title>surface</title>');
      const unchanged = yield* get('/project/chat', { accept: 'text/html', 'if-none-match': shell.headers.etag! });
      expect([unchanged.status, unchanged.headers['cache-control']]).toEqual([304, 'no-cache']);
      const version = yield* get('/_app/version.json');
      expect([version.status, version.headers['cache-control']]).toEqual([200, 'no-cache']);
      expect((yield* get('/startup', { origin: 'https://example.com' })).status).toBe(403);
    }).pipe(Effect.ensuring(Effect.andThen(Deferred.succeed(proceed, undefined), Fiber.await(opening))));
    const store = Context.get(yield* Fiber.join(opening), MachineStore);
    const ready = HttpRouter.serve(
      Layer.mergeAll(
        HttpRouter.add('GET', '/health', HttpServerResponse.jsonUnsafe({ ok: true })),
        HttpRouter.add(
          'POST',
          '/api/op/read_machine_state',
          Effect.map(store.db.all(sql`select name from sqlite_master where name = 'opened'`), (rows) =>
            HttpServerResponse.jsonUnsafe(rows),
          ),
        ),
      ),
      { disableLogger: true, disableListenLog: true },
    ).pipe(Layer.provide(Layer.succeedContext(context)));
    yield* Scope.provide(Layer.build(ready), active);
    yield* Scope.close(starting, Exit.void);
    records.point('door-ready', { door: 'local', at: yield* Clock.currentTimeMillis });
    expect(yield* Effect.flatMap(get('/health'), (response) => response.json)).toEqual({ ok: true });
    expect(yield* Effect.flatMap(client.post(`${url}/api/op/read_machine_state`), (response) => response.json)).toEqual([
      { name: 'opened' },
    ]);
    expect((yield* readStartup(records.path)).startup?.status).toBe('ready');
    yield* Scope.close(active, Exit.void);
    expect(yield* Effect.flip(get('/health'))).toMatchObject({ reason: { _tag: 'TransportError', cause: { code: 'ECONNREFUSED' } } });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BunFileSystem.layer,
        FetchHttpClient.layer,
        serverProcessesLayer(resolve(import.meta.dir, '../../../../../../..', 'packages/execution-host'), undefined),
      ),
    ),
  ),
);

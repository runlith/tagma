import { afterAll, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { RESTART_RECORD } from '../contract/wire/restart.js';
import { makeProcessRestart, readStartup } from './record.js';
import { awaitStart, awaitRestart, readRemoteStartup } from './serverStart.js';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';
import { LOCK_FILE } from '../../platform/contract/wire/lock.js';

const remote = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) =>
    new URL(request.url).pathname === '/startup'
      ? new Response('Not Found', { status: 404 })
      : Response.json(
          {
            ok: false,
            startup: null,
            issue: null,
            restart: { id: 'remote-restart', stage: 'failed', underway: false, failure: 'remote successor exited', stays: false },
          },
          { status: 503 },
        ),
});
afterAll(() => remote.stop(true));

it.live('a remote restart wait consumes a recorded failure from the health 503 when startup is not published', () =>
  Effect.gen(function* () {
    const outcome = yield* awaitRestart(
      Effect.succeed(null),
      null,
      readRemoteStartup(`http://127.0.0.1:${remote.port}`),
      { isSuccessor: () => false, build: () => 'new', expected: 'new' },
      () => Effect.void,
    );
    expect(outcome).toEqual({ _tag: 'Failed', detail: 'remote successor exited' });
  }),
);

it.live('a stale lock-file pid that belongs to a live process does not keep a restart waiting on a free flock', () =>
  Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'tagma-free-lock-'))),
      (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
    );
    writeFileSync(join(home, LOCK_FILE), String(process.pid));
    const outcome = yield* awaitRestart(
      Effect.succeed(null),
      () => dataDirectoryLocked(home),
      Effect.succeed({ startup: null, issue: null }),
      { isSuccessor: () => false, build: () => 'new', expected: 'new' },
      () => Effect.void,
    );
    expect(outcome).toEqual({ _tag: 'Silent' });
  }),
);

it.live('a persisted startup failure ends the CLI start wait with its recorded cause', () =>
  Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'tagma-coming-up-'))),
      (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
    );
    const path = join(home, RESTART_RECORD);
    const records = yield* makeProcessRestart({ path, pid: process.pid });
    records.start(yield* Clock.currentTimeMillis);
    records.fail('migration refused');
    const outcome = yield* awaitStart(
      { pid: process.pid, exitCode: null, signalCode: null },
      Effect.succeed(null),
      () => process.pid,
      readStartup(path),
      () => Effect.void,
    );
    expect(outcome).toEqual({ _tag: 'Failed', detail: 'migration refused' });
  }),
);

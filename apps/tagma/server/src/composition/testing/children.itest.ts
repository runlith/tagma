import { expect } from 'bun:test';
import { resolve } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect, Layer, Logger } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import { ChildProcess } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { sql } from 'drizzle-orm';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { ChildLedger } from '../../platform/contract/service/children.js';
import { signedBy } from '../../invocation/testing/call.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { ledgeredSpawner } from '../../platform/git/ledgered.js';
import { childLedgerLayer } from '../children.js';

const host = resolve(import.meta.dir, '../../../../../..', 'packages/execution-host');

it.live('unavailable native attribution warns once at assembly and retains unreadable child identities', () =>
  Effect.gen(function* () {
    const warnings: unknown[] = [];
    const logger = Logger.make(({ message }) => {
      warnings.push(message);
    });
    yield* Effect.gen(function* () {
      const ledger = yield* ChildLedger;
      const git = ledger.record({ pid: 10, role: 'git' });
      const database = ledger.record({ pid: 11, role: 'database' });
      expect(ledger.of(10)?.identity._tag).toBe('Unreadable');
      expect(ledger.of(11)?.identity._tag).toBe('Unreadable');
      git();
      database();
    }).pipe(Effect.provide(childLedgerLayer(undefined, undefined)), Effect.provide(Logger.layer([logger])));
    expect(warnings).toHaveLength(1);
  }),
);

it.live('server composition witnesses git and SQLite children, and releases their role declarations', () =>
  Effect.gen(function* () {
    const ledger = yield* ChildLedger;
    let gitPid = 0;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* ChildProcess.make('/usr/bin/git', ['hash-object', '--stdin'], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'ignore',
        });
        gitPid = child.pid;
        expect(ledger.of(gitPid)).toMatchObject({
          role: 'git',
          thread: ThreadId.make('role-thread'),
          identity: { _tag: 'Read', pid: gitPid },
        });
      }).pipe(Effect.provide(ledgeredSpawner('git').pipe(Layer.provide(BunServices.layer)))),
    );
    expect(ledger.of(gitPid)).toBeUndefined();
    let databasePid = 0;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        yield* db.all(sql`select 1`);
        expect(ledger.of(databasePid)).toMatchObject({ role: 'database', identity: { _tag: 'Read', pid: databasePid } });
      }).pipe(
        Effect.provide(
          sqliteProcessLayer(
            {
              filename: ':memory:',
              readers: 0,
              onLost: (reason) => {
                throw new Error(reason);
              },
              onSpawned: ({ pid }) => {
                databasePid = pid;
                return ledger.record({ pid, role: 'database' });
              },
            },
            new ProcessPool(undefined, 'stop', undefined, childHosting),
          ),
        ),
      ),
    );
    expect(ledger.of(databasePid)).toBeUndefined();
  }).pipe(Effect.provide(childLedgerLayer(host, undefined)), signedBy({ harness: NATIVE_HARNESS, key: 'role-thread' })),
);

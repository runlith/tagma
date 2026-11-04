import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('a SQLite child leaves as soon as its owner dies, without waiting for a parent poll', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sqlite-orphan-'));
  const script = `
    import { Effect, Layer } from 'effect';
    import { ProcessPool } from './ProcessPool.ts';
    import { childHosting } from './children.ts';
    import { sqliteProcessLayer } from './SqliteProcess.ts';
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* Layer.build(sqliteProcessLayer({
        filename: ${JSON.stringify(join(directory, 'store.db'))},
        onLost: (reason) => { throw new Error(reason); },
        onSpawned: ({ pid }) => { process.send?.({ sqlite: pid }); return () => {}; },
      }, new ProcessPool(2, 'stop', undefined, childHosting)));
      yield* Effect.promise(() => new Promise(() => process.send?.('ready')));
    })));
  `;
  const pids: number[] = [];
  let ready!: () => void;
  const announced = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const owner = Bun.spawn([process.execPath, '-e', script], {
    cwd: import.meta.dir,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    ipc: (message) => {
      if (message === 'ready') ready();
      else if (typeof message === 'object' && message !== null && 'sqlite' in message && typeof message.sqlite === 'number') {
        pids.push(message.sqlite);
      }
    },
  });
  try {
    await announced;
    expect(pids.length).toBeGreaterThan(0);
    owner.kill('SIGKILL');
    await owner.exited;
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    while (pids.some(alive)) await Bun.sleep(5);
    expect(pids.filter(alive)).toEqual([]);
  } finally {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('a Unix terminal hangup leaves SQLite available until its owner closes the store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sqlite-lifetime-'));
  const filename = join(directory, 'store.db');
  const script = `
    import { Context, Effect, Layer } from 'effect';
    import { SqlClient } from 'effect/sql/SqlClient';
    import { ProcessPool } from './ProcessPool.ts';
    import { childHosting } from './children.ts';
    import { sqliteProcessLayer } from './SqliteProcess.ts';
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const context = yield* Layer.build(sqliteProcessLayer({
        filename: ${JSON.stringify(filename)},
        onLost: (reason) => { throw new Error(reason); },
        onSpawned: ({ pid }) => { process.send?.({ sqlite: pid }); return () => {}; },
      }, new ProcessPool(2, 'stop', undefined, childHosting)));
      const sql = Context.get(context, SqlClient);
      yield* sql\`CREATE TABLE item (value INTEGER)\`;
      yield* Effect.promise(() => new Promise((resolve) => {
        process.once('SIGHUP', resolve);
        process.send?.('ready');
      }));
      yield* sql.withTransaction(sql\`INSERT INTO item VALUES (1)\`);
    })));
    process.disconnect();
  `;
  let sqlitePid: number | undefined;
  let ready!: () => void;
  const announced = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const owner = Bun.spawn([process.execPath, '-e', script], {
    cwd: import.meta.dir,
    detached: true,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    ipc: (message) => {
      if (message === 'ready') ready();
      else if (typeof message === 'object' && message !== null && 'sqlite' in message && typeof message.sqlite === 'number') {
        sqlitePid = message.sqlite;
      }
    },
  });
  const stderr = new Response(owner.stderr).text();
  try {
    await Promise.race([
      announced,
      owner.exited.then((code) => {
        throw new Error(`SQLite owner exited ${code} before opening its store`);
      }),
    ]);
    if (sqlitePid === undefined) throw new Error('SQLite owner announced no child');
    process.kill(sqlitePid, 'SIGHUP');
    process.kill(sqlitePid, 'SIGTERM');
    process.kill(-owner.pid, 'SIGHUP');
    expect(await owner.exited, await stderr).toBe(0);
    const stored = new Database(filename, { readonly: true });
    try {
      expect(stored.query('SELECT value FROM item').all()).toEqual([{ value: 1 }]);
    } finally {
      stored.close();
    }
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    await owner.exited;
    await rm(directory, { recursive: true, force: true });
  }
});

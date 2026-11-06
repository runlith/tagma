import { expect, test } from 'bun:test';
import type { SqliteAsk, SqliteSaid } from './channel.js';
import { Checkpoints } from './Checkpoints.js';
import { type ProcessChannel, ProcessPool } from './ProcessPool.js';
import { inlineHosting } from './inline.js';

type Driver = { readonly sent: SqliteAsk[]; readonly say: (said: SqliteSaid) => void; readonly lose: (reason: string) => void };

class RecordedPool extends ProcessPool {
  readonly drivers: Driver[] = [];

  override connect(
    _lane: number | undefined,
    receive: (said: SqliteSaid) => void,
    lost: (reason: string) => { readonly announce: () => void; readonly wake: () => void },
  ): ProcessChannel {
    const sent: SqliteAsk[] = [];
    this.drivers.push({
      sent,
      say: receive,
      lose: (reason) => {
        const loss = lost(reason);
        loss.announce();
        loss.wake();
      },
    });
    return {
      pid: this.drivers.length,
      send: (ask) => {
        sent.push(ask);
      },
      release: async () => {},
      retire: async () => {},
      kill: async () => {},
    };
  }
}

const owned = (losses: string[], name: string) => (reason: string) => ({
  announce: () => {
    losses.push(`${name}: ${reason}`);
  },
  wake: () => {},
});

const passes = (driver: Driver) => driver.sent.filter((ask) => ask._tag === 'Checkpoint');

test('a closing owner waits for the pass in flight on its file, and a kept driver answers each pass to the file that asked for it', async () => {
  const pool = new RecordedPool(0, 'stop', undefined, inlineHosting);
  const checkpoints = new Checkpoints(pool, () => true);
  const losses: string[] = [];
  checkpoints.add(1, 'a.db', false, owned(losses, 'a'), undefined);
  checkpoints.changed('a.db');
  let dropped = false;
  const dropping = checkpoints.drop(1).then(() => {
    dropped = true;
  });
  const [driver] = pool.drivers;
  const [first] = passes(driver!);
  await Promise.resolve();
  expect(dropped).toBe(false);
  const thrown = {
    name: 'SQLiteError',
    message: 'unable to open database file',
    code: 'SQLITE_CANTOPEN',
    errno: 14,
    constraint: undefined,
  };
  driver!.say({ _tag: 'Failed', id: first!.id, thrown, queueMs: 0, execMs: 0 });
  await dropping;
  checkpoints.add(2, 'b.db', false, owned(losses, 'b'), undefined);
  checkpoints.changed('b.db');
  const [, second] = passes(driver!);
  expect([first, second].map((ask) => ask?._tag === 'Checkpoint' && ask.filename)).toEqual(['a.db', 'b.db']);
  driver!.say({ _tag: 'Checkpointed', id: second!.id, log: 0, copied: 0 });
  expect(losses).toEqual([]);
  expect(pool.drivers.length).toBe(1);
});

test('a checkpoint driver lost during a pass leaves its replacement free to run the next pass', async () => {
  const pool = new RecordedPool(0, 'stop', undefined, inlineHosting);
  const checkpoints = new Checkpoints(pool, () => true);
  const losses: string[] = [];
  checkpoints.add(1, 'a.db', true, owned(losses, 'a'), undefined);
  checkpoints.changed('a.db');
  pool.drivers[0]!.lose('killed');
  expect(losses).toEqual(['a: The WAL checkpoint process was lost: killed']);
  checkpoints.add(2, 'b.db', true, owned(losses, 'b'), undefined);
  checkpoints.changed('b.db');
  expect(pool.drivers.length).toBe(2);
  expect(passes(pool.drivers[1]!).map((ask) => ask._tag === 'Checkpoint' && ask.filename)).toEqual(['b.db']);
});

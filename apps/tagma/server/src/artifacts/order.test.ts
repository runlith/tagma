import { expect, test } from 'bun:test';
import {
  admits,
  compacts,
  COMPACTION_MIN,
  retryAfter,
  decodeRecord,
  encodeRecord,
  type OrderLog,
  type OrderRecord,
  walk,
  type WalkKey,
} from './order.js';

const shelf = (epoch = 1) => {
  const records: OrderRecord[] = [];
  const heads = new Map<string, number>();
  let live = 0;
  const log = (): OrderLog => ({
    epoch,
    confirmed: records.length,
    live,
    records: (from, to) => records.slice(from, to),
    head: (id) => heads.get(id) ?? null,
  });
  const publish = (id: string, version: string) => {
    const prev = heads.get(id) ?? -1;
    if (prev < 0) live += 1;
    const versions = prev < 0 ? 1 : Math.min(20, (records[prev]?.versions ?? 0) + 1);
    heads.set(id, records.length);
    records.push({ id, version, prev, versions });
  };
  return { log, publish };
};

const id = (letter: string) => letter.repeat(12);

const walkAll = (log: () => OrderLog, limit: number, between: (page: number) => void = () => {}) => {
  const seen: string[] = [];
  let after: WalkKey | null = null;
  for (let page = 0; ; page += 1) {
    const read = walk(log(), after, limit);
    if (read.kind !== 'rows') throw new Error(`the walk answered ${read.kind}`);
    seen.push(...read.rows.map((row) => `${row.id.slice(0, 1)}${row.version}/${row.versions}`));
    const last = read.rows[read.rows.length - 1];
    if (!read.more || last === undefined) return seen;
    after = last.key;
    between(page);
  }
};

test('a walk answers the shelf as it stood at its first page, newest republish first', () => {
  const { log, publish } = shelf();
  publish(id('a'), '1');
  publish(id('b'), '1');
  publish(id('a'), '2');
  publish(id('c'), '1');
  const seen = walkAll(log, 1, (page) => {
    if (page === 0) {
      publish(id('b'), '2');
      publish(id('a'), '3');
      publish(id('d'), '1');
    }
  });
  expect(seen).toEqual(['c1/1', 'a2/2', 'b1/1']);
  expect(walkAll(log, 2)).toEqual(['d1/1', 'a3/3', 'b2/2', 'c1/1']);
});

test('a page republished many times during a walk is answered once at its standing position', () => {
  const { log, publish } = shelf();
  for (const letter of ['a', 'b', 'c', 'd']) publish(id(letter), '1');
  const seen = walkAll(log, 1, () => {
    for (let version = 2; version < 30; version += 1) publish(id('b'), String(version));
  });
  expect(seen).toEqual(['d1/1', 'c1/1', 'b1/1', 'a1/1']);
});

test('a cursor from another epoch is stale', () => {
  const { log, publish } = shelf(1);
  publish(id('a'), '1');
  publish(id('b'), '1');
  const first = walk(log(), null, 1);
  if (first.kind !== 'rows') throw new Error('the first page was refused');
  const compacted = shelf(2);
  compacted.publish(id('a'), '1');
  compacted.publish(id('b'), '1');
  expect(walk(compacted.log(), first.rows[0]!.key, 1).kind).toBe('stale');
});

test('a head pointing into another page chain is broken, never answered', () => {
  const records: OrderRecord[] = [
    { id: id('a'), version: '1', prev: -1, versions: 1 },
    { id: id('b'), version: '1', prev: -1, versions: 1 },
  ];
  const log: OrderLog = {
    epoch: 1,
    confirmed: 2,
    live: 2,
    records: (from, to) => records.slice(from, to),
    head: () => 1,
  };
  const after: WalkKey = { epoch: 1, snapshot: 1, total: 1, seq: 1 };
  expect(walk(log, after, 5).kind).toBe('broken');
});

test('compaction starts once superseded records reach the live count, never below the floor', () => {
  expect(compacts(COMPACTION_MIN - 1 + 10, 10)).toBe(false);
  expect(compacts(COMPACTION_MIN + 10, 10)).toBe(true);
  expect(compacts(2000 + 1999, 2000)).toBe(false);
  expect(compacts(4000, 2000)).toBe(true);
});

test('after a failed compaction the next attempt waits for another threshold of publishes', () => {
  const retryAt = retryAfter(4000, 2000);
  expect(compacts(4001, 2000, retryAt)).toBe(false);
  expect(compacts(retryAt - 1, 2000, retryAt)).toBe(false);
  expect(compacts(retryAt, 2000, retryAt)).toBe(true);
});

test('a publish is admitted until superseded records would pass four times the standing pages', () => {
  expect(admits(499, 100, false)).toBe(true);
  expect(admits(500, 100, false)).toBe(false);
  expect(admits(500, 100, true)).toBe(true);
  expect(admits(265, 10, false)).toBe(true);
  expect(admits(266, 10, false)).toBe(false);
});

test('a record reads back as written, and a torn or foreign line reads as nothing', () => {
  const record: OrderRecord = { id: '0123456789ab', version: '20260928T213617077Z-3', prev: 4096, versions: 20 };
  const line = encodeRecord(record);
  expect(Buffer.byteLength(line)).toBe(64);
  expect(decodeRecord(line)).toEqual(record);
  expect(decodeRecord(encodeRecord({ ...record, prev: -1 }))).toEqual({ ...record, prev: -1 });
  expect(decodeRecord(line.slice(0, 40))).toBeNull();
  expect(decodeRecord(`${'z'.repeat(12)}${line.slice(12)}`)).toBeNull();
});

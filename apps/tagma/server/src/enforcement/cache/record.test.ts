import { describe, expect, test } from 'bun:test';
import {
  cacheBudget,
  cacheWrites,
  calibrationKeyOf,
  readCacheRecord,
  readCalibrationRecord,
  recordDigest,
  writeCalibrationRecord,
} from './record.js';

describe('derived inspection records', () => {
  test('reserves one percent of available disk, bounded by four source envelopes', () => {
    expect(cacheBudget(10_000, 100)).toBe(100);
    expect(cacheBudget(1_000_000, 100)).toBe(400);
    expect(cacheBudget(99, 100)).toBe(0);
    expect(cacheBudget(0, 100)).toBe(0);
  });

  test('rejects corrupted contents and misplaced records', () => {
    const key = 'parse:blob:js:2';
    const body = JSON.stringify([{ specifier: 'node:fs', line: 2, clause: true, loads: 'with-module', forwards: false, form: 'import' }]);
    const digest = recordDigest(key, body);
    expect(readCacheRecord('parse', key, body, digest)?.[0]?.specifier).toBe('node:fs');
    expect(readCacheRecord('parse', 'parse:other', body, digest)).toBeUndefined();
    expect(readCacheRecord('parse', key, body.replace('node:fs', 'node:os'), digest)).toBeUndefined();
    const malformed = '[{"loads":"never"}]';
    expect(readCacheRecord('parse', key, malformed, recordDigest(key, malformed))).toBeUndefined();
    expect(readCacheRecord('memo', key, body, digest)).toBeUndefined();
  });

  test('keeps a frontier summary whole, since a slice that finds it stripped would ask for it again', () => {
    const key = 'memo:platforms/entry/3/abc';
    const hit = {
      group: '\0fs',
      suffix: 'fs',
      distance: 1,
      chain: ['packages/a/src/b.ts'],
      file: 'packages/a/src/b.ts',
      line: 2,
      specifier: 'node:fs',
    };
    const body = JSON.stringify({
      dependencies: [['packages/a/src/a.ts', 'blob']],
      listings: [],
      parents: ['scc'],
      violations: [],
      hits: [hit],
      read: [],
    });
    expect(readCacheRecord('memo', key, body, recordDigest(key, body))?.hits).toEqual([hit]);
  });

  test('bounded batches evict staged rows and discard a failed ask', () => {
    const writes = cacheWrites<string>(6, (key, value) => key.length + (value?.length ?? 0));
    writes.set('a', '12');
    writes.set('b', '34');
    expect(writes.drain()).toEqual([
      ['a', '12'],
      ['b', '34'],
    ]);
    writes.set('a', '123');
    writes.set('b', '45');
    expect(writes.get('a')).toBeUndefined();
    writes.discard();
    expect(writes.drain()).toEqual([]);
  });

  test('settled batches preserve latest-use order without losing a pending write', () => {
    const writes = cacheWrites<string>();
    writes.set('a', 'first');
    writes.set('b', 'second');
    writes.touch('a');
    writes.touch('old');
    writes.set('b', 'replacement');
    expect(writes.get('a')).toBe('first');
    expect(writes.drain()).toEqual([
      ['a', 'first'],
      ['old', undefined],
      ['b', 'replacement'],
    ]);
    expect(writes.drain()).toEqual([]);
  });

  test('keeps a calibration per builtin, rejecting other keys and damage', () => {
    const value = {
      builtin: 'held-resources',
      cbMsPerFile: 2.5,
      dbMsPerMib: 40,
      probeMs: 40,
      probeFiles: 16,
      probeMib: 0.5,
      measuredAt: 1_700_000_000_000,
    };
    const key = calibrationKeyOf('held-resources');
    const { body, digest } = writeCalibrationRecord(value);
    expect(readCalibrationRecord(key, body, digest)).toEqual(value);
    expect(readCalibrationRecord('memo:held-resources', body, digest)).toBeUndefined();
    expect(readCalibrationRecord(key, `${body} `, digest)).toBeUndefined();
    expect(readCalibrationRecord(key, body, recordDigest(key, body))).toEqual(value);
  });
});

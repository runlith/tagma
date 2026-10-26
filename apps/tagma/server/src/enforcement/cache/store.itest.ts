import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { MemoValue } from '@tagma/inspection/node/memo';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CacheDegraded, openCache } from './store.js';

const unnoted = (): void => undefined;
const roots: string[] = [];
const paths = () => {
  const root = mkdtempSync(join(tmpdir(), 'inspection-cache-'));
  roots.push(root);
  return join(root, 'cache.sqlite');
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const value = (path = 'source.ts'): MemoValue => ({ dependencies: [[path, 'blob']], listings: [], violations: [], read: [path] });

describe('worker inspection cache', () => {
  test('shares settled records between handles and across a worker restart', () => {
    const path = paths();
    const first = openCache(path, 1024 * 1024, unnoted);
    const second = openCache(path, 1024 * 1024, unnoted);
    try {
      first.memo.set('start', value());
      first.parses.set('blob:js:2', []);
      expect(second.memo.get('start')).toBeUndefined();
      first.flush();
      expect(second.memo.get('start')).toEqual(value());
      expect(second.parses.get('blob:js:2')).toEqual([]);
    } finally {
      first.close();
      second.close();
    }
    const restarted = openCache(path, 1024 * 1024, unnoted);
    try {
      expect(restarted.memo.get('start')).toEqual(value());
    } finally {
      restarted.close();
    }
  });

  test('flushes staged facts in chunks without orphaning start dependencies', () => {
    const path = paths();
    const cache = openCache(path, 1024 * 1024, unnoted);
    try {
      for (let at = 0; at < 400; at += 1)
        cache.parses.set(`blob:${at}`, [
          {
            specifier: `package/${String(at).padStart(4, '0')}/${'x'.repeat(1024)}`,
            line: 1,
            clause: false,
            loads: 'with-module',
            forwards: false,
            form: 'import',
          },
        ]);
      cache.memo.set('start', value('blob:0'));
      cache.flush();
    } finally {
      cache.close();
    }
    const reopened = openCache(path, 1024 * 1024, unnoted);
    try {
      expect(reopened.parses.get('blob:0')).toHaveLength(1);
      expect(reopened.parses.get('blob:399')).toHaveLength(1);
      expect(reopened.memo.get('start')).toEqual(value('blob:0'));
    } finally {
      reopened.close();
    }
  });

  test('evicts the least recently read record under a shared byte budget', () => {
    const path = paths();
    const one = openCache(path, 64 * 1024, unnoted);
    const two = openCache(path, 64 * 1024, unnoted);
    const record = (): MemoValue => ({ ...value(), read: ['a'.repeat(15500)] });
    try {
      for (let at = 0; at < 8; at += 1) one.memo.set(`r${at}`, record());
      one.flush();
      expect(two.memo.get('r0')).toEqual(record());
      two.memo.set('r8', record());
      two.flush();
    } finally {
      one.close();
      two.close();
    }
    const three = openCache(path, 64 * 1024, unnoted);
    try {
      expect(three.memo.get('r1')).toBeUndefined();
      expect(three.memo.get('r0')).toEqual(record());
      expect(three.memo.get('r8')).toEqual(record());
    } finally {
      three.close();
    }
  });

  test('a file at its page ceiling keeps taking records: the least recently read give way instead of every write failing', () => {
    const path = paths();
    const noted: CacheDegraded[] = [];
    const cache = openCache(path, 64 * 1024, (cause) => noted.push(cause));
    const record = (at: number): MemoValue => ({ ...value(), read: [`${at}`.padEnd(15500, 'a')] });
    try {
      for (let at = 0; at < 8; at += 1) cache.memo.set(`r${at}`, record(at));
      cache.flush();
      for (const root of ['one', 'two', 'three']) cache.rest.set(`rest:${root}`, { listing: 'b'.repeat(60_000) });
      for (let at = 8; at < 16; at += 1) {
        cache.memo.set(`r${at}`, record(at));
        cache.flush();
      }
    } finally {
      cache.close();
    }
    const reopened = openCache(path, 64 * 1024, (cause) => noted.push(cause));
    try {
      expect(noted).toEqual([]);
      expect(reopened.memo.get('r15')).toEqual(record(15));
      expect(reopened.memo.get('r0')).toBeUndefined();
      expect(reopened.rest.get('rest:three')).toEqual({ listing: 'b'.repeat(60_000) });
    } finally {
      reopened.close();
    }
  });

  test('the kept states of many checkouts never fill the file: the least recently kept gives way', () => {
    const path = paths();
    const noted: CacheDegraded[] = [];
    const cache = openCache(path, 64 * 1024, (cause) => noted.push(cause));
    const state = (at: number) => ({ listing: `${at}`.padEnd(60_000, 'c') });
    try {
      for (let at = 0; at < 8; at += 1) cache.rest.set(`rest:${at}`, state(at));
      expect(noted).toEqual([]);
      expect(cache.rest.get('rest:7')).toEqual(state(7));
      expect(cache.rest.get('rest:0')).toBeUndefined();
    } finally {
      cache.close();
    }
  });

  test('rebuilds damaged files, and rejects a torn row', () => {
    const path = paths();
    const cache = openCache(path, 1024 * 1024, unnoted);
    cache.memo.set('start', value());
    cache.close();
    const tampered = new Database(path);
    tampered.query('UPDATE entry SET body = ? WHERE key = ?').run('{}', 'memo:start');
    tampered.close();
    const checked = openCache(path, 1024 * 1024, unnoted);
    try {
      expect(checked.memo.get('start')).toBeUndefined();
    } finally {
      checked.close();
    }
    writeFileSync(path, 'broken database');
    const noted: CacheDegraded[] = [];
    const recovered = openCache(path, 1024 * 1024, (cause) => noted.push(cause));
    try {
      expect(noted.map((cause) => cause._tag)).toEqual(['CacheDegraded']);
      expect(recovered.memo.get('start')).toBeUndefined();
      recovered.memo.set('fresh', value());
      recovered.flush();
      expect(recovered.memo.get('fresh')).toEqual(value());
    } finally {
      recovered.close();
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { mayReference, mayTouch, watchEventOf } from './tree.js';

const KINDS = ['create', 'update', 'delete'] as const;

test('file observers select named events and preserve full rescans when their names are unknown', () => {
  for (const kind of KINDS) {
    expect(mayTouch(watchEventOf({ kind, path: 'config' }), 'config')).toBe(true);
    expect(mayTouch(watchEventOf({ kind, path: 'index' }), 'config')).toBe(false);
    expect(mayTouch(watchEventOf({ kind, path: 'config.lock' }), 'config')).toBe(false);
    expect(mayTouch(watchEventOf({ kind, path: 'attributes' }), 'exclude')).toBe(false);
  }
  for (const rescan of ['unnamed', 'error', 'lost', 'polling', 'opened'] as const) {
    expect(mayTouch({ rescan }, 'config')).toBe(true);
  }
});

test('reference observers skip named locks and preserve atomic refs and unknown rescans', () => {
  for (const kind of KINDS) {
    expect(mayReference(watchEventOf({ kind, path: 'heads/main.lock' }))).toBe(false);
    expect(mayReference(watchEventOf({ kind, path: 'heads/main' }))).toBe(true);
  }
  expect(mayReference({ rescan: 'unnamed' })).toBe(true);
  expect(mayReference({ rescan: 'error', paths: ['main.lock'] })).toBe(true);
});

describe('watchEventOf', () => {
  test('a changed file reports itself', () => {
    expect(watchEventOf({ kind: 'update', path: 'a/b' })).toEqual({ paths: ['a/b'] });
  });

  test('a created or deleted path rescans the membership it changed and names the path', () => {
    expect(watchEventOf({ kind: 'create', path: 'a/b' })).toEqual({ rescan: 'rename', paths: ['a/b'] });
    expect(watchEventOf({ kind: 'delete', path: 'a' })).toEqual({ rescan: 'rename', paths: ['a'] });
  });
});

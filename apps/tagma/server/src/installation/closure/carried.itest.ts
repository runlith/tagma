import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, test } from 'bun:test';
import { RIPGREP_PART } from '../contract/wire/layout.js';
import { carriedFrom, presentCarried } from './carried.js';

const tree = mkdtempSync('/tmp/tagma-carried-');
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const entryIn = (name: string, options: { readonly installed: boolean }): string => {
  const root = join(tree, name);
  mkdirSync(join(root, 'bin/server'), { recursive: true });
  if (options.installed) writeFileSync(join(root, 'install.json'), '{"version":1}\n');
  return pathToFileURL(join(root, 'bin/server/http.js')).href;
};

test('an entry standing in a closure names the ripgrep that closure carries', () => {
  expect(carriedFrom(entryIn('closure', { installed: true }), RIPGREP_PART)).toBe(join(tree, 'closure/tools/rg'));
});

test('an entry with no manifest above it carries nothing', () => {
  expect(carriedFrom(entryIn('checkout', { installed: false }), RIPGREP_PART)).toBeNull();
});

test('a carried binary that still stands is the answer', () => {
  const binary = join(tree, 'closure/tools/rg');
  mkdirSync(join(tree, 'closure/tools'), { recursive: true });
  writeFileSync(binary, 'rg');
  expect(presentCarried(binary)).toBe(binary);
});

test('a carried binary removed after the reading answers nothing', () => {
  const binary = join(tree, 'pruned/tools/rg');
  mkdirSync(join(tree, 'pruned/tools'), { recursive: true });
  writeFileSync(binary, 'rg');
  rmSync(binary);
  expect(presentCarried(binary)).toBeNull();
});

test('no carried binary answers nothing', () => {
  expect(presentCarried(null)).toBeNull();
});

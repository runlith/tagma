import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { holdDirectory, leaseDirectory } from './directoryLease.js';
import { pruneVersions } from './versionLeases.js';
import { swapCurrent } from './versionedDirectories.js';

const owned = mkdtempSync('/tmp/tagma-versions-');
afterAll(() => rmSync(owned, { recursive: true, force: true }));

test('a prune removes the unkept versions but keeps a leased one, the kept one and the files beside them', () => {
  for (const version of ['v1', 'v2', 'v3']) mkdirSync(join(owned, version));
  writeFileSync(join(owned, 'record.json'), '{}\n');
  swapCurrent(owned, 'v3');
  expect(leaseDirectory(join(owned, 'v1'))).toBe('leased');

  pruneVersions(owned, ['v3']);

  expect(readdirSync(owned).sort()).toEqual(['current', 'record.json', 'v1', 'v3']);
});

test('no lease is granted on a version while its prune removes it', () => {
  const root = mkdtempSync(join(owned, 'race-'));
  mkdirSync(join(root, 'old'));
  mkdirSync(join(root, 'new'));
  const leasesDuringRemoval: Array<(() => void) | null> = [];

  pruneVersions(root, ['new'], (dir) => leasesDuringRemoval.push(holdDirectory(dir)));

  expect(leasesDuringRemoval).toEqual([null]);
  expect(readdirSync(root)).toEqual(['new']);
});

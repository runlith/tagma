import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAttempt } from './attempt.js';
import { claimLeased, pruneReleases } from './leases.js';
import { swapCurrent } from '../../platform/lock/versionedDirectories.js';
import { publishStaged, releasesNewestFirst } from './versions.js';

const tree = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-prune-')));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const release = (at: string): string => {
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, 'install.json'), '{}');
  return at;
};

const forget = (): void => undefined;

const standing = (root: string) =>
  readdirSync(root)
    .filter((name) => name !== 'current' && !name.endsWith('.json'))
    .sort();

test('a prune removes only releases nobody holds: a foreign directory, the release being installed and both sides of the attempt current stands on stay', () => {
  const root = join(tree, 'pruning');
  for (const version of ['v1', 'v2', 'v3', 'v4']) release(join(root, version));
  mkdirSync(join(root, 'notes'));
  const claimed = claimLeased(root, new Date('2026-10-14T00:00:00Z'));
  release(claimed.root);
  swapCurrent(root, 'v3');
  writeAttempt(root, { from: 'v2', to: 'v3', starts: 1, copied: true, ended: null });

  pruneReleases(root, ['v4'], forget);
  expect(standing(root)).toEqual([claimed.version, 'notes', 'v2', 'v3', 'v4'].sort());

  claimed.release();
  swapCurrent(root, 'v4');
  pruneReleases(root, ['v4'], forget);
  expect(standing(root)).toEqual(['notes', 'v4']);
});

test('a release still being copied is no release: stepping back does not see it, and once its installer is gone the next prune removes it', () => {
  const root = join(tree, 'copying');
  release(join(root, 'v4'));
  mkdirSync(join(root, 'notes'));
  const claimed = claimLeased(root, new Date('2026-10-14T01:00:00Z'));
  release(claimed.root);
  expect(releasesNewestFirst(root)).toEqual(['v4']);
  claimed.release();
  pruneReleases(root, ['v4'], forget);
  expect(standing(root)).toEqual(['notes', 'v4']);

  const published = claimLeased(root, new Date('2026-10-14T02:00:00Z'));
  release(published.root);
  const version = publishStaged(root, published.version, new Date('2026-10-14T02:00:00Z'));
  published.release();
  expect(releasesNewestFirst(root)).toEqual(['v4', version]);
});

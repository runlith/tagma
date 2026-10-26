import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { resolveStorageLayout, StorageLayoutInvalid } from './layout.js';

const base = { projectName: 'runlith', appHome: '/home/u/.tagma' };

describe('storage layout', () => {
  it.effect('each storage mode places its tree and repository under the owning home', () =>
    Effect.gen(function* () {
      const stealth = yield* resolveStorageLayout({ ...base, mode: 'stealth', worktree: '/w/repo' });
      expect(stealth).toMatchObject({ mode: 'stealth', gitDir: '/home/u/.tagma/graphs/runlith/graph.git' });
      expect(stealth.treeRoot.startsWith('/home/u/.tagma/graphs/runlith/trees/repo-')).toBe(true);
      expect(stealth.mirrorPath.startsWith('/home/u/.tagma/mirror/runlith/')).toBe(true);

      const team = yield* resolveStorageLayout({ ...base, mode: 'team', worktree: '/w/repo' });
      expect(team).toMatchObject({ mode: 'team', treeRoot: '/w/repo/.tagma' });
    }),
  );

  it.effect('two checkouts of one project get two trees and two mirrors', () =>
    Effect.gen(function* () {
      const a = yield* resolveStorageLayout({ ...base, mode: 'stealth', worktree: '/w/repo' });
      const b = yield* resolveStorageLayout({ ...base, mode: 'stealth', worktree: '/w/repo-wt2' });
      expect(a.treeRoot).not.toBe(b.treeRoot);
      expect(a.mirrorPath).not.toBe(b.mirrorPath);
    }),
  );

  it.effect('a checkout mode without a checkout refuses', () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(resolveStorageLayout({ ...base, mode: 'stealth' }))).toBeInstanceOf(StorageLayoutInvalid);
    }),
  );
});

import { expect } from 'bun:test';
import { Effect } from 'effect';
import type { BranchRefs } from '../contract/service/refs.js';
import { GRAPH_COMMIT_PATTERN } from '../../graph/contract/wire/storage.js';

export type BranchRefFixture = {
  readonly refs: BranchRefs['Service'];
  readonly path: string;
  readonly commit: string;
  readonly base: string;
  readonly work: string;
  readonly tree: string;
  readonly squash: string;
  readonly merged: string;
};

export const branchRefContract = Effect.fnUntraced(function* ({ refs, path, commit, base, work, tree, squash, merged }: BranchRefFixture) {
  expect(yield* refs.head(path)).toEqual({ ref: 'refs/heads/topic', commit });
  expect(yield* refs.commit(path, 'refs/heads/topic')).toBe(commit);
  expect(yield* refs.commit(path, 'refs/heads/missing')).toBeNull();
  expect(yield* refs.published(path, 'topic')).toBe(true);
  expect(yield* refs.published(path, 'tracked')).toBe(true);
  expect(yield* refs.published(path, 'taken')).toBe(false);
  expect(yield* refs.commit(path, base)).toBe(base);
  expect(yield* refs.changes(path, base, commit)).toEqual(['.tagma/note.md', 'work.txt']);
  expect(yield* refs.changes(path, commit, tree)).toEqual([]);
  expect(yield* refs.changes(path, commit, squash)).toEqual([]);
  expect(yield* refs.changes(path, squash, merged)).toEqual([]);
  expect(yield* refs.commits(path, { base, tip: commit, limit: 1 })).toEqual([{ sha: commit, subject: 'tagma: graph @ 7 (amber-fox)' }]);
  expect(yield* refs.commits(path, { base, tip: commit, limit: 1, excludeSubject: GRAPH_COMMIT_PATTERN })).toEqual([
    { sha: work, subject: 'user work' },
  ]);

  yield* refs.rename(path, 'topic', 'renamed');
  expect(yield* refs.head(path)).toEqual({ ref: 'refs/heads/renamed', commit });
  expect(yield* refs.commit(path, 'refs/heads/topic')).toBeNull();
  expect(yield* refs.commit(path, 'refs/heads/renamed')).toBe(commit);
  expect(yield* refs.published(path, 'topic')).toBe(true);
  expect(yield* refs.published(path, 'renamed')).toBe(false);

  yield* refs.rename(path, 'tracked', 'tracked-again');
  expect(yield* refs.published(path, 'tracked-again')).toBe(true);
  for (const target of ['taken', 'occupied']) {
    const refused = yield* Effect.flip(refs.rename(path, 'renamed', target));
    expect(refused._tag).toBe('BranchRefRefused');
    expect(yield* refs.head(path)).toEqual({ ref: 'refs/heads/renamed', commit });
  }
  expect(yield* refs.commit(path, 'refs/heads/taken')).toBe(squash);
  expect(yield* refs.commit(path, 'refs/heads/occupied/child')).toBe(commit);
  yield* refs.remove(path, 'taken');
  expect(yield* refs.commit(path, 'refs/heads/taken')).toBeNull();
  expect((yield* Effect.flip(refs.remove(path, 'renamed')))._tag).toBe('BranchRefRefused');
  expect((yield* Effect.flip(refs.remove(path, 'missing')))._tag).toBe('BranchRefRefused');
  expect(yield* refs.head(path)).toEqual({ ref: 'refs/heads/renamed', commit });
});

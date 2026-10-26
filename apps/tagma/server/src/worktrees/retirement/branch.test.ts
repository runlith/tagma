import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { RepositoryId } from '../../workspace/contract/wire/repositories.js';
import type { FinishingGuards } from '../contract/service/finishingGate.js';
import type { MergeChecks } from '../contract/service/mergeChecks.js';
import { BranchRefRefused, BranchRefs, BranchRefsUnavailable } from '../contract/service/refs.js';
import type { WorktreeRecord } from '../contract/service/worktrees.js';
import { type WorktreeMode, WorktreeRevision } from '../contract/wire/creation.js';
import { makeActProgress } from '../progress.js';
import { memoryBranchRefs } from '../testing/refs.js';
import { makeBranchDeletion } from './branch.js';

const BASE = 'base';
const TIP = 'tip';
const TREE = 'merged-tree';
const WORK = 'work';
const PATH = '/repo/.git';
const unused = () => Effect.die('branch deletion reached an unrelated collaborator');

type BranchCase = {
  readonly changes?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly mode?: WorktreeMode;
  readonly baseBranch?: string | null;
  readonly branch?: string | null;
};

const fixture = Effect.fnUntraced(function* (input: BranchCase = {}) {
  const rootId = RootId.make('side');
  const record: WorktreeRecord = {
    rootId,
    projectId: 1,
    name: 'side',
    path: '/repo/side',
    branch: input.branch === undefined ? 'side' : input.branch,
    baseBranch: input.baseBranch === undefined ? 'main' : input.baseBranch,
    baseCommit: BASE,
    origin: 'created',
    hue: 0,
    setup: 'done',
    setupDetail: null,
    taskId: null,
    createdAt: new Date(0),
  };
  const names = new Map([
    ['refs/heads/main', BASE],
    ['refs/heads/side', TIP],
  ]);
  const refs = memoryBranchRefs(
    new Map([
      [
        PATH,
        {
          head: { ref: 'refs/heads/main', commit: BASE },
          refs: names,
          tracking: new Set(),
          facts: {
            objects: new Set([BASE, TIP, TREE]),
            changes: new Map([[`${BASE}|${TREE}`, input.changes ?? ['work.txt']]]),
            history: new Map([
              [
                `${BASE}|${TIP}`,
                [
                  { sha: TIP, subject: 'tagma: graph @ 7 (amber-fox)' },
                  { sha: WORK, subject: 'user work' },
                ],
              ],
            ]),
          },
        },
      ],
    ]),
  );
  const guards: FinishingGuards = {
    recorded: unused,
    present: unused,
    stands: unused,
    branchOf: unused,
    baseOf: unused,
    working: unused,
    retiring: unused,
    quiet: unused,
    holders: unused,
    baseCheckout: unused,
    placeOf: unused,
    operationOf: () =>
      Effect.succeed({
        operationId: RequestKey.make('side'),
        projectId: 1,
        repository: { repositoryId: RepositoryId.make('repo'), locationRevision: LocationRevision.make(1) },
        destination: '/repo/side',
        mode: input.mode ?? { kind: 'new-branch', branch: 'side', start: BASE },
        namespaceId: NamespaceId.make('host'),
        base: BASE,
        payloadDigest: 'intent',
        status: 'ready',
        reserved: false,
        producer: null,
        rootId,
        evidence: null,
        abandonment: null,
        revision: WorktreeRevision.make(1),
      }),
    commonOf: () => Effect.succeed(PATH),
  };
  const checks: MergeChecks = {
    check: unused,
    fresh: () => Effect.succeed({ tree: TREE, conflicts: input.conflicts ?? [], yielded: [] }),
    holds: unused,
    saved: unused,
    last: unused,
    standing: unused,
    onTaken: () => () => {},
    forget: unused,
  };
  const progress = yield* makeActProgress;
  const make = (port: BranchRefs['Service']) =>
    makeBranchDeletion({ guards, checks, progress }).pipe(Effect.provideService(BranchRefs, port));
  return { record, names, refs, deletion: yield* make(refs), make };
});

it.effect('content-equivalent and graph-only branches are deleted, including squash content without shared ancestry', () =>
  Effect.gen(function* () {
    for (const input of [
      { changes: [] },
      { changes: ['.tagma/note.md', '.merge_file_a1b2c3'] },
      { changes: [], conflicts: ['.tagma/note.md', '.merge_file_a1b2c3'] },
      { changes: [], baseBranch: null },
    ] satisfies readonly BranchCase[]) {
      const { deletion, record, refs } = yield* fixture(input);
      expect(yield* deletion.remove(record)).toEqual({ status: 'deleted', name: 'side' });
      expect(yield* refs.commit(PATH, 'refs/heads/side')).toBeNull();
    }
  }),
);

it.effect('work and conflicts retain the branch and report only its user commits', () =>
  Effect.gen(function* () {
    for (const input of [
      { changes: ['work.txt'] },
      { conflicts: ['work.txt'] },
      { changes: ['.tagma/workflows/ship.yml'] },
    ] satisfies readonly BranchCase[]) {
      const { deletion, record, refs } = yield* fixture(input);
      expect(yield* deletion.remove(record)).toMatchObject({
        status: 'kept',
        name: 'side',
        commits: [{ sha: WORK, subject: 'user work' }],
      });
      expect(yield* refs.commit(PATH, 'refs/heads/side')).toBe(TIP);
    }
  }),
);

it.effect('a missing base or a branch created outside this operation is retained; a missing branch is already deleted', () =>
  Effect.gen(function* () {
    const missing = yield* fixture();
    missing.names.delete('refs/heads/main');
    expect(yield* missing.deletion.remove(missing.record)).toMatchObject({ status: 'kept', name: 'side', commits: [] });
    expect(yield* missing.refs.commit(PATH, 'refs/heads/side')).toBe(TIP);
    const foreign = yield* fixture({ mode: { kind: 'existing-branch', branch: 'side' }, changes: [] });
    expect(yield* foreign.deletion.remove(foreign.record)).toMatchObject({ status: 'kept', name: 'side', commits: [] });
    expect(yield* foreign.refs.commit(PATH, 'refs/heads/side')).toBe(TIP);
    const detached = yield* fixture({ branch: null });
    expect(yield* detached.deletion.remove(detached.record)).toMatchObject({ status: 'kept', name: null, commits: [] });
    const gone = yield* fixture();
    gone.names.delete('refs/heads/side');
    expect(yield* gone.deletion.remove(gone.record)).toEqual({ status: 'deleted', name: 'side' });
  }),
);

it.effect('typed failures reading branch facts or deleting the ref keep the branch with the resource reason', () =>
  Effect.gen(function* () {
    const unread = yield* fixture({ changes: [] });
    const failure = new BranchRefsUnavailable({ message: 'the repository is unavailable' });
    const blocked = yield* unread.make(BranchRefs.of({ ...unread.refs, changes: () => Effect.fail(failure) }));
    const kept = yield* blocked.remove(unread.record);
    expect(kept.status).toBe('kept');
    expect(kept.status === 'kept' ? kept.reason : '').toContain(failure.message);
    expect(yield* unread.refs.commit(PATH, 'refs/heads/side')).toBe(TIP);
    const refused = new BranchRefRefused({ message: 'the branch is checked out elsewhere' });
    const held = yield* unread.make(BranchRefs.of({ ...unread.refs, remove: () => Effect.fail(refused) }));
    const retained = yield* held.remove(unread.record);
    expect(retained.status).toBe('kept');
    expect(retained.status === 'kept' ? retained.reason : '').toContain(refused.message);
    expect(yield* unread.refs.commit(PATH, 'refs/heads/side')).toBe(TIP);
  }),
);

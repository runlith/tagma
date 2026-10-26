import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { MachineUnits, writeUnitOf } from '../../platform/contract/service/units.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { BranchTwinning } from '../contract/service/branches.js';
import { WorktreeThreads } from '../contract/service/finishingGate.js';
import { FinishingGate } from '../contract/service/retirement.js';
import { BranchRefs } from '../contract/service/refs.js';
import { WorktreeRecords, type WorktreeRecord } from '../contract/service/worktrees.js';
import { memoryBranchRefs, type MemoryBranchCheckout } from '../testing/refs.js';
import { makeProvisionalBranches } from './provisional.js';

const fixture = Effect.fnUntraced(function* () {
  const path = '/repo/side';
  const rootId = RootId.make('side');
  const from = 'tagma/thread-a1b2c3';
  const commit = '1'.repeat(40);
  const checkout: MemoryBranchCheckout = {
    head: { ref: `refs/heads/${from}`, commit },
    refs: new Map([[`refs/heads/${from}`, commit]]),
    tracking: new Set(),
  };
  let record: WorktreeRecord = {
    rootId,
    projectId: 1,
    name: 'side',
    path,
    branch: from,
    baseBranch: 'main',
    baseCommit: commit,
    origin: 'created',
    hue: 0,
    setup: 'done',
    setupDetail: null,
    taskId: null,
    createdAt: new Date(0),
  };
  let namedBy: string | null = 'thread';
  let standing: RootId | null = rootId;
  const unit = writeUnitOf<'machine'>({
    store: { path: 'memory', generation: 1 },
    run: () => Effect.die('the title owner must not issue SQL'),
    afterCommit: (work) => work,
  });
  const units = MachineUnits.of({
    read: (work) => work(unit),
    write: (_operation, work) => work(unit),
    markReadOnly: (work) => work,
    markWrite: (work) => work,
  });
  const unused = () => Effect.die('the title owner read an unrelated record operation');
  const records = WorktreeRecords.of({
    record: unused,
    records: unused,
    recordedRoots: unused,
    byRoot: unused,
    unsettled: unused,
    settle: unused,
    drop: unused,
    nameAfter: unused,
    liveProjects: unused,
    namedAfter: (threadId) => Effect.sync(() => (threadId === namedBy ? record : null)),
    renamed: (askedRoot, before, to, _unit, threadId) =>
      Effect.sync(() => {
        if (askedRoot !== rootId || record.branch !== before || (threadId !== undefined && threadId !== namedBy)) return false;
        record = { ...record, branch: to };
        namedBy = null;
        return true;
      }),
    unnamed: (_rootId, threadId) =>
      Effect.sync(() => {
        if (namedBy === threadId) namedBy = null;
      }),
  });
  const refs = memoryBranchRefs(new Map([[path, checkout]]));
  const threads = yield* Layer.build(
    Layer.mock(WorktreeThreads, {
      threadsMoved: () => () => {},
      stopping: () => () => {},
      standingRoot: () => Effect.sync(() => standing),
    }),
  );
  const branches = yield* makeProvisionalBranches.pipe(
    Effect.provideContext(
      Context.make(MachineUnits, units).pipe(
        Context.add(WorktreeRecords, records),
        Context.add(BranchRefs, refs),
        Context.add(BranchTwinning, { twins: (_place, rename) => rename }),
        Context.add(WorktreeThreads, Context.get(threads, WorktreeThreads)),
        Context.add(FinishingGate, { hold: (_key, work) => work }),
      ),
    ),
  );
  return {
    branches,
    refs,
    checkout,
    path,
    rootId,
    from,
    record: () => record,
    leave: () => {
      standing = null;
    },
  };
});

it.effect('a provisional name follows one title and preserves its prefix and stable suffix', () =>
  Effect.gen(function* () {
    const { branches, refs, path, rootId, record } = yield* fixture();
    expect(yield* branches.titled('thread', 'Fix Login Redirect')).toEqual({
      status: 'renamed',
      rootId,
      from: 'tagma/thread-a1b2c3',
      to: 'tagma/fix-login-redirect-a1b2c3',
    });
    expect((yield* refs.head(path)).ref).toBe('refs/heads/tagma/fix-login-redirect-a1b2c3');
    expect(record().branch).toBe('tagma/fix-login-redirect-a1b2c3');
    expect(yield* branches.titled('thread', 'Another Title')).toBeNull();
  }),
);

it.effect('publication, placement, another branch, an occupied name and an unspellable title each retire automatic naming', () =>
  Effect.gen(function* () {
    for (const condition of ['published', 'left', 'off-branch', 'occupied', 'unspellable'] as const) {
      const { branches, refs, checkout, path, from, record, leave } = yield* fixture();
      if (condition === 'published') checkout.refs.set(`refs/remotes/origin/${from}`, checkout.head.commit ?? '');
      if (condition === 'left') leave();
      if (condition === 'off-branch') checkout.head = { ...checkout.head, ref: 'refs/heads/elsewhere' };
      if (condition === 'occupied') checkout.refs.set('refs/heads/tagma/some-title-a1b2c3', '2'.repeat(40));
      const title = condition === 'unspellable' ? 'Починить вход' : 'Some Title';
      expect((yield* branches.titled('thread', title))?.status).toBe('kept');
      expect(record().branch).toBe(from);
      expect((yield* refs.head(path)).ref).toBe(condition === 'off-branch' ? 'refs/heads/elsewhere' : `refs/heads/${from}`);
      expect(yield* refs.commit(path, `refs/heads/${from}`)).toBe(checkout.head.commit);
      expect(yield* branches.titled('thread', 'Another Title')).toBeNull();
    }
  }),
);

it.effect('a rename completed before its record was written is reconciled by the next title', () =>
  Effect.gen(function* () {
    const { branches, refs, path, from, rootId, record } = yield* fixture();
    yield* refs.rename(path, from, 'tagma/half-way-a1b2c3');
    expect(yield* branches.titled('thread', 'Half..Way')).toEqual({
      status: 'renamed',
      rootId,
      from,
      to: 'tagma/half-way-a1b2c3',
    });
    expect(record().branch).toBe('tagma/half-way-a1b2c3');
    expect((yield* refs.head(path)).ref).toBe('refs/heads/tagma/half-way-a1b2c3');
  }),
);

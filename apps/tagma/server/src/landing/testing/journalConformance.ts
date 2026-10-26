import { expect } from 'bun:test';
import { Effect } from 'effect';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { IntentLifecycle } from '../store/intentLifecycle.js';
import type { MergeRequestRow, MergeRequests } from '../store/mergeRequests.js';
import type { PendingMergeStore, PendingRecord } from '../store/pendingMerges.js';

export type MergeJournalFixture = {
  readonly projectId: number;
  readonly lifecycle: IntentLifecycle;
  readonly mergeRequests: MergeRequests;
  readonly pendingStore: PendingMergeStore;
  readonly units: MachineUnits['Service'];
};

export const verifyMergeJournal = Effect.fnUntraced(function* (fixture: MergeJournalFixture) {
  const { projectId, lifecycle, mergeRequests, pendingStore, units } = fixture;
  const rootId = RootId.make('journal-side');
  const caller = { _tag: 'Thread', threadId: ThreadId.make('queuer'), projectId } as const;
  const request: MergeRequestRow = {
    request: 'request',
    rootId,
    baseRootId: RootId.make('journal-main'),
    name: 'side',
    branch: 'side',
    baseBranch: 'main',
    mode: 'rebase',
    source: 'source',
    after: 'delete',
    end: null,
    caller,
    waitedSince: new Date(1),
    afterState: 'waiting',
    afterDone: null,
    sourcePath: '/side',
    sourceState: 'pending',
    sourceReason: null,
    rulesAfter: false,
  };
  const intent = {
    key: 'merge-contract',
    kind: 'merge' as const,
    projectId,
    phase: 'publishing' as const,
    repository: '/git',
    checkout: '/main',
    ref: 'refs/heads/main',
    base: 'base',
    tree: 'tree',
    commit: 'commit',
    witnessedAt: new Date(2),
    at: new Date(2),
  };
  yield* mergeRequests.intend(intent, request);
  expect(yield* lifecycle.open('merge', null, 1)).toMatchObject([intent]);
  expect((yield* mergeRequests.of([intent.key])).get(intent.key)).toEqual(request);
  expect(yield* mergeRequests.tailOpen(rootId)).toMatchObject([{ phase: 'publishing', commit: 'commit' }]);
  yield* lifecycle.receive(intent.key, 'commit', new Date(3));
  yield* mergeRequests.afterRunning(intent.key);
  yield* mergeRequests.afterDone(intent.key, { act: 'delete', outcome: 'done', reason: null });
  yield* mergeRequests.sourceSettled(intent.key, 'done', null);
  yield* mergeRequests.rulesTold(intent.key);
  expect((yield* mergeRequests.of([intent.key])).get(intent.key)).toMatchObject({
    afterState: 'done',
    sourceState: 'done',
    rulesAfter: true,
  });
  yield* units.write('merge-contract.close', (unit) => mergeRequests.close(unit, intent.key));
  yield* lifecycle.receive(intent.key, 'commit', new Date(4));
  yield* lifecycle.witness(intent.key, 'late-commit', new Date(4));
  yield* lifecycle.lose(intent.key);
  yield* mergeRequests.afterRunning(intent.key);
  expect((yield* mergeRequests.of([intent.key])).get(intent.key)?.afterState).toBe('done');
  expect(yield* lifecycle.open('merge', null, 1)).toEqual([]);
  expect(yield* lifecycle.read(intent.key)).toMatchObject({ intent: { phase: 'settled' }, receipt: { key: intent.key, commit: 'commit' } });
  expect(yield* lifecycle.prune('merge', new Date(4), 1)).toBe(1);
  expect(yield* lifecycle.read(intent.key)).toBeNull();
  expect((yield* mergeRequests.of([intent.key])).size).toBe(0);
  const pending: PendingRecord = {
    rootId,
    projectId,
    mode: 'merge',
    message: 'queued',
    after: 'delete',
    state: 'waiting',
    queuedAt: new Date(5),
    attempts: 1,
    refusal: { code: 'base-held', message: 'held', unblock: ['wait'] },
    stoppedOn: null,
    end: null,
    caller,
  };
  yield* units.write('merge-contract.put', (unit) => pendingStore.put(pending, unit));
  expect(yield* units.read((unit) => pendingStore.byRoot(rootId, unit))).toEqual(pending);
  expect(yield* units.read((unit) => pendingStore.ofProject(projectId, unit))).toEqual([pending]);
  const stopped: PendingRecord = { ...pending, state: 'stopped', stoppedOn: 'basis', attempts: 2 };
  expect(yield* units.write('merge-contract.replace', (unit) => pendingStore.replace(pending, stopped, unit))).toBe(true);
  expect(yield* units.write('merge-contract.stale', (unit) => pendingStore.replace(pending, null, unit))).toBe(false);
  expect(yield* units.write('merge-contract.older', (unit) => pendingStore.dropAsked(rootId, new Date(4), unit))).toBe(false);
  expect(yield* units.write('merge-contract.drop', (unit) => pendingStore.dropAsked(rootId, new Date(5), unit))).toBe(true);
  expect(yield* units.read((unit) => pendingStore.all(unit))).toEqual([]);
});

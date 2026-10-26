import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { basisOf } from '../queue/basis.js';
import { UNCHECKED } from '../../enforcement/contract/wire/checks.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { BASE_ROOT, mergeFixture, SIDE_ROOT } from '../testing/mergeFixture.js';

const refusal = <A, E extends { readonly _tag: string }>(work: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(work), (failure) => ('reason' in failure ? failure.reason : failure._tag));

it.effect('merge, squash and rebase publish their parentage and receipt without moving an unrelated checkout edit', () =>
  Effect.gen(function* () {
    for (const mode of ['merge', 'squash', 'rebase'] as const) {
      const fixture = yield* mergeFixture();
      fixture.memory.checkouts.get('/main')!.files['draft.txt'] = 'unfinished\n';
      const merged = yield* fixture.merges.merge(1, SIDE_ROOT, { mode });
      const made = fixture.memory.commits.get(merged.base.head)!;
      expect(made.parents).toEqual(mode === 'merge' ? [fixture.base, fixture.tip] : [fixture.base]);
      expect(fixture.memory.checkouts.get('/main')!.files).toEqual({
        'seed.txt': 'seed\n',
        'feature.txt': 'feature\n',
        'draft.txt': 'unfinished\n',
      });
      expect(fixture.memory.refs.get('refs/heads/main')).toBe(merged.base.head);
      expect(fixture.receipts).toMatchObject([{ rootId: SIDE_ROOT, mode, commit: merged.base.head }]);
    }
  }),
);

it.effect('merge admission refuses conflicting, staged, held and dirty base paths before publication', () =>
  Effect.gen(function* () {
    for (const reason of [
      'merge-conflicts',
      'base-staged',
      'base-held',
      'base-dirty',
      'base-mid-operation',
      'operation-in-progress',
    ] as const) {
      const fixture = yield* mergeFixture();
      const entry = { path: 'feature.txt', status: 'added' as const, lines: { added: 1, removed: 0 } };
      const entries = fixture.state(BASE_ROOT).entries;
      if (reason === 'merge-conflicts')
        fixture.memory.compare(fixture.base, fixture.tip, { tree: fixture.sideTree, conflicts: ['feature.txt'], yielded: [] });
      else if (reason === 'base-staged')
        yield* fixture.change(BASE_ROOT, { entries: { ...entries, staged: { entries: [entry], added: 1, removed: 0 } } });
      else if (reason === 'base-mid-operation') yield* fixture.change(BASE_ROOT, { operation: 'merge' });
      else if (reason === 'operation-in-progress') yield* fixture.change(SIDE_ROOT, { operation: 'merge' });
      else {
        yield* fixture.change(BASE_ROOT, { entries: { ...entries, untracked: { entries: [entry], added: 1, removed: 0 } } });
        if (reason === 'base-held')
          fixture.held.set('feature.txt', [
            { holder: { kind: 'thread', thread: 'writer' }, agentName: 'writer', tasks: [], retired: false, writing: true },
          ]);
      }
      expect(yield* refusal(fixture.merges.merge(1, SIDE_ROOT, {}))).toBe(reason);
      expect(fixture.memory.refs.get('refs/heads/main')).toBe(fixture.base);
      expect(fixture.journal.intents.size).toBe(0);
    }
  }),
);

it.effect('the merged tree is judged before publication and a refusal leaves both branches unchanged', () =>
  Effect.gen(function* () {
    const judged: string[] = [];
    const fixture = yield* mergeFixture({
      rules: {
        before: (subject) =>
          Effect.sync(() => {
            if (subject.kind === 'tree') judged.push(subject.built);
            return {
              ...UNCHECKED,
              refused: { code: 'rule-violated', reason: 'the merged tree crosses the rule', unblock: ['repair the branch'] },
            };
          }),
        after: () => Effect.void,
      },
    });
    expect(yield* refusal(fixture.merges.merge(1, SIDE_ROOT, {}))).toBe('rule-violated');
    expect(judged).toEqual([fixture.sideTree]);
    expect(fixture.memory.refs.get('refs/heads/main')).toBe(fixture.base);
    expect(fixture.memory.refs.get('refs/heads/side')).toBe(fixture.tip);
  }),
);

it.effect('a second squash refuses work the base already holds', () =>
  Effect.gen(function* () {
    const fixture = yield* mergeFixture();
    const merged = yield* fixture.merges.merge(1, SIDE_ROOT, { mode: 'squash' });
    fixture.memory.compare(merged.base.head, fixture.tip, { tree: fixture.sideTree, conflicts: [], yielded: [] });
    expect(yield* refusal(fixture.merges.merge(1, SIDE_ROOT, { mode: 'squash' }))).toBe('already-merged');
    expect(fixture.memory.refs.get('refs/heads/main')).toBe(merged.base.head);
  }),
);

it.effect('rebase refuses a replay whose tree loses a merge resolution', () =>
  Effect.gen(function* () {
    const fixture = yield* mergeFixture();
    const replayed = fixture.memory.commit({ tree: fixture.baseTree, parents: [fixture.base], message: 'resolution lost', sign: false });
    fixture.memory.replayed(fixture.base, fixture.tip, replayed);
    expect(yield* refusal(fixture.merges.merge(1, SIDE_ROOT, { mode: 'rebase' }))).toBe('rebase-merges');
    expect(fixture.memory.refs.get('refs/heads/main')).toBe(fixture.base);
    expect(fixture.memory.refs.get('refs/heads/side')).toBe(fixture.tip);
  }),
);

it.effect('a pending merge retains its caller and deletion choice across queue restart, and cancel removes the request', () =>
  Effect.gen(function* () {
    const fixture = yield* mergeFixture();
    const entry = { path: 'feature.txt', status: 'added' as const, lines: { added: 1, removed: 0 } };
    yield* fixture.change(BASE_ROOT, {
      entries: { ...fixture.state(BASE_ROOT).entries, untracked: { entries: [entry], added: 1, removed: 0 } },
    });
    fixture.held.set('feature.txt', [
      { holder: { kind: 'thread', thread: 'writer' }, agentName: 'writer', tasks: [], retired: false, writing: true },
    ]);
    const caller = { _tag: 'Thread', threadId: ThreadId.make('queuer'), projectId: 1 } as const;
    const ask = { mode: 'merge', message: null, after: 'delete', end: null, caller } as const;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* fixture.queue();
        const queued = yield* queue.merge(1, SIDE_ROOT, ask, true);
        expect('queued' in queued && queued.queued.refusal?.code).toBe('base-held');
        yield* queue.cancel(1, SIDE_ROOT);
        expect(yield* queue.ofProject(1)).toEqual([]);
        expect(yield* refusal(queue.cancel(1, SIDE_ROOT))).toBe('not-pending');
        yield* queue.merge(1, SIDE_ROOT, ask, true);
      }),
    );
    expect(fixture.journal.pending.get(SIDE_ROOT)?.caller).toEqual(caller);
    fixture.held.clear();
    fixture.states.delete(BASE_ROOT);
    const restarted = yield* fixture.queue();
    expect(yield* restarted.resume()).toBe(1);
    yield* TestClock.adjust('500 millis');
    expect(yield* restarted.ofProject(1)).toEqual([]);
    expect(fixture.deleted.has(SIDE_ROOT)).toBe(true);
    expect(fixture.receipts[0]?.after.act).toBe('delete');
    expect(fixture.memory.refs.get('refs/heads/main')).not.toBe(fixture.base);
  }),
);

it.effect('a stopped queued merge retries when its source operation ends without either tip moving', () =>
  Effect.gen(function* () {
    const fixture = yield* mergeFixture();
    yield* fixture.change(SIDE_ROOT, { operation: 'merge' });
    const before = fixture.state(SIDE_ROOT);
    fixture.journal.pending.set(SIDE_ROOT, {
      rootId: SIDE_ROOT,
      projectId: 1,
      mode: 'merge',
      message: null,
      after: 'keep',
      state: 'stopped',
      queuedAt: new Date(0),
      attempts: 2,
      refusal: { code: 'operation-in-progress', message: 'an operation is in progress', unblock: ['end it'] },
      stoppedOn: basisOf('operation-in-progress', { tree: { state: before, held: 0 }, base: { state: fixture.state(BASE_ROOT), held: 0 } }),
      end: null,
      caller: null,
    });
    const queue = yield* fixture.queue();
    expect(yield* queue.resume()).toBe(1);
    yield* TestClock.adjust('500 millis');
    expect((yield* queue.ofProject(1))[0]?.state).toBe('stopped');
    const moved = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        queue.onMoved(() => {
          Deferred.doneUnsafe(moved, Effect.void);
        }),
      ),
      (off) => Effect.sync(off),
    );
    yield* fixture.change(SIDE_ROOT, { ...before, operation: 'none' });
    yield* TestClock.adjust('500 millis');
    yield* Deferred.await(moved);
    expect(yield* queue.ofProject(1)).toEqual([]);
    expect(fixture.memory.refs.get('refs/heads/main')).not.toBe(fixture.base);
  }),
);

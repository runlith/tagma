import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { ThreadTransitions } from '../ThreadPorts';
import { threadSpokenMessageEvent } from '../events';
import { sealThreadEvents } from '../ThreadEventDoor';
import { actDigest } from '../keyed';
import { transitionNow, type TransitionDeps } from '../transition/kernel';
import { runTransition, ThreadRunSequences, threadRunSequencesLayer } from '../transition/sequence';
import { SequenceUnavailable, ThreadActReusedError, type TransitionPlan } from '../transition/port';
import { writerOrderedLane, type ThreadJournalLaneFaces } from '../transition/lane';
import type { ThreadStorageFactory, ThreadStorageHarness } from './storagePort';
import { INSTANCE, OWNER, SCOPE, startInput, started, settlePatch } from './storagePort/support';
export function describeRunTransitions<TTx, TWrite extends TTx>(name: string, open: ThreadStorageFactory<TTx, TWrite>): void {
  describe(`${name}: run transitions`, () => {
    it.live(
      'a cut replays the latest sequence, restart resumes, and an ended run refuses every later transition',
      Effect.fnUntraced(function* () {
        let storage = yield* open();
        let sequences = yield* sequencesOver(storage);
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(storage.runs({ ownerId: INSTANCE, scope: SCOPE }).createRun(startInput(thread)));
        const plan: TransitionPlan<number, TWrite> = {
          declared: [],
          decide: ({ row }) =>
            Effect.succeed({ apply: true, result: (row.budgetTokens ?? 0) + 1, patch: { budgetTokens: (row.budgetTokens ?? 0) + 1 } }),
        };
        let cut = true;
        const lane: ThreadJournalLaneFaces = {
          ...writerOrderedLane,
          enter: (_id, _place, work) =>
            Effect.map(work, (ran) => {
              if (!cut) return { ran };
              cut = false;
              return { stalled: 'uncertain' as const };
            }),
        };
        const deps = (): TransitionDeps<TTx, TWrite> => ({
          store: storage.aggregate,
          log: storage.eventLog,
          transitions: storage.transitions,
          lane,
          kinds: storage.kinds,
        });
        const first = () => runTransition(deps(), sequences, run, plan, 'first');
        expect(yield* first()).toMatchObject({ stalled: 'uncertain', key: { evidence: { run: run.id, seq: 1 } } });
        expect(yield* first()).toEqual({ replayed: 1 });
        expect((yield* storage.aggregate.find(thread.id))?.budgetTokens).toBe(1);
        expect(yield* runTransition(deps(), sequences, run, plan, 'second')).toEqual({ committed: 2 });
        const key = { evidence: { run: run.id, seq: 2 }, digest: actDigest('second') };
        expect(yield* transitionNow(deps(), thread.id, plan, key)).toEqual({ replayed: 2 });
        expect(yield* Effect.flip(transitionNow(deps(), thread.id, plan, { ...key, digest: actDigest('changed') }))).toBeInstanceOf(
          ThreadActReusedError,
        );
        expect(
          yield* Effect.flip(transitionNow(deps(), thread.id, plan, { evidence: { run: run.id, seq: 1 }, digest: actDigest('first') })),
        ).toMatchObject({ _tag: 'SequenceUnavailable', reason: 'advanced' });
        storage = yield* storage.reopen();
        sequences = yield* sequencesOver(storage);
        expect(yield* runTransition(deps(), sequences, run, plan, 'third')).toEqual({ committed: 3 });
        expect(yield* storage.transitions.appliedSeq(run.id)).toBe(3);
        expect((yield* storage.aggregate.find(thread.id))?.budgetTokens).toBe(3);
        yield* storage.runs({ ownerId: INSTANCE, scope: SCOPE }).settleRun(run.id, yield* settlePatch('completed'));
        const ended = yield* Effect.flip(transitionNow(deps(), thread.id, plan, key));
        expect(ended).toBeInstanceOf(SequenceUnavailable);
        expect(ended).toMatchObject({ reason: 'ended' });
        expect(yield* storage.transitions.appliedSeq(run.id)).toBe(3);
        expect((yield* storage.aggregate.find(thread.id))?.budgetTokens).toBe(3);
        const tail = {
          ...plan,
          declared: sealThreadEvents([
            threadSpokenMessageEvent({ role: 'assistant', text: 'tail', occurredAt: '2026-10-10T18:00:00.000Z' }),
          ]),
        };
        const tailKey = { evidence: { run: run.id, seq: 4 }, digest: actDigest('tail') };
        expect(yield* Effect.flip(transitionNow(deps(), thread.id, tail, tailKey))).toMatchObject({
          _tag: 'SequenceUnavailable',
          reason: 'ended',
        });
        expect(yield* storage.transitions.appliedSeq(run.id)).toBe(3);
        expect(yield* storage.eventLog.eventsAfter(thread.id, 0, 1)).toHaveLength(0);
      }),
    );
  });
}
const sequencesOver = Effect.fnUntraced(function* <TTx, TWrite extends TTx>(storage: ThreadStorageHarness<TTx, TWrite>) {
  const context = yield* Layer.build(
    threadRunSequencesLayer.pipe(
      Layer.provide(Layer.succeed(ThreadTransitions, storage.transitions as unknown as ThreadTransitions['Service'])),
    ),
  );
  return Context.get(context, ThreadRunSequences);
});

import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { actDigest, type Evidence, type Keyed } from '../keyed';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { makeRacingThreadTransitions } from '../storage/RacingThreadTransitions';
import type { ThreadSealedEvent } from '../ThreadEventDoor';
import { ThreadCallBroke } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { control, prepareTransition, readBirthRecord, transition, transitionIn, writeBirthRecord, type TransitionDeps } from './kernel';
import { writerOrderedLane, type ThreadJournalLaneFaces, type ThreadLanePlace } from './lane';
import { ThreadActReusedError, ThreadVersionStaleError, type Decision, type TransitionPlan } from './port';
import { makeThreadEntryReader } from '../../transcript/kinds';
const THREAD = 'thread-1';
const occurredAt = '2026-09-29T12:00:00.000Z';
const later = new Date('2100-01-01T00:00:00.000Z');
const world = Effect.gen(function* () {
  const memory = yield* makeRacingThreadTransitions;
  memory.seed(makeAggregateStorage().row(THREAD));
  const deps: TransitionDeps<undefined> = {
    store: memory.store,
    log: memory.log,
    transitions: memory,
    lane: writerOrderedLane,
    kinds: makeThreadEntryReader({ products: [] }),
  };
  return { memory, deps };
});
function message(id: string, text: string): ThreadSealedEvent {
  return { id, body: { kind: 'message', payload: { entry: { type: 'message', id: `entry-${id}`, role: 'user', text, occurredAt } } } };
}
function keyed(evidence: Evidence, request: unknown): Keyed {
  return { evidence, digest: actDigest(request) };
}
function plan(
  declared: readonly ThreadSealedEvent[],
  decide: () => Decision<string, undefined> = () => ({ apply: true, result: 'done' }),
): TransitionPlan<string, undefined> {
  return { declared, decide: () => Effect.succeed(decide()) };
}
describe('kernel transition port', () => {
  it.effect(
    'a transition appends its declared events and writes their fold with its record in one unit',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const key = keyed({ run: 'run-1', seq: 1 }, 'step-1');
      const outcome = yield* transition(deps, THREAD, plan([message('e1', 'hello')]), { key, deadline: later });
      expect(outcome).toEqual({ committed: 'done' });
      const held = memory.held(THREAD);
      expect(held.events.map((event) => event.position)).toEqual([1]);
      expect(held.transcript.map((entry) => entry.id)).toEqual(['entry-e1']);
    }),
  );
  it.effect(
    'events a decision derives in the unit append after the declared ones and fold onto the prepared state',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const key = keyed({ settlement: 'run-1', effects: ['c1'] }, 'settle');
      const derived: TransitionPlan<string, undefined> = {
        declared: [message('e1', 'declared')],
        decide: () =>
          Effect.succeed({
            apply: true,
            result: 'settled',
            events: [
              { kind: 'message', payload: { entry: { type: 'message', id: 'entry-derived', role: 'user', text: 'derived', occurredAt } } },
            ],
          }),
      };
      expect(yield* transition(deps, THREAD, derived, { key, deadline: later })).toEqual({ committed: 'settled' });
      const held = memory.held(THREAD);
      expect(held.events.map((event) => event.position)).toEqual([1, 2]);
      expect(held.transcript.map((entry) => entry.id)).toEqual(['entry-e1', 'entry-derived']);
    }),
  );
  it.effect(
    'a committed act retried under its key replays its result and runs no participant again',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const key = keyed({ call: { namespace: 'note:actor', id: 'k1' } }, 'note');
      let ran = 0;
      const counted = plan([message('e1', 'note')], () => ({
        apply: true,
        result: 'noted',
        participants: () =>
          Effect.sync(() => {
            ran += 1;
          }),
      }));
      yield* transition(deps, THREAD, counted, { key, deadline: later });
      expect(yield* transition(deps, THREAD, counted, { key, deadline: later })).toEqual({ replayed: 'noted' });
      expect(ran).toBe(1);
      expect(memory.held(THREAD).events).toHaveLength(1);
    }),
  );
  it.effect(
    'a changed request under a call key refuses as a reused act after later calls',
    Effect.fnUntraced(function* () {
      const { deps } = yield* world;
      const first = { call: { namespace: 'note:actor', id: 'one' } };
      yield* transition(deps, THREAD, plan([message('e1', 'a')]), { key: keyed(first, 'a'), deadline: later });
      yield* transition(deps, THREAD, plan([message('e2', 'b')]), {
        key: keyed({ call: { namespace: 'note:actor', id: 'two' } }, 'b'),
        deadline: later,
      });
      const failure = yield* Effect.flip(
        transition(deps, THREAD, plan([message('e3', 'c')]), { key: keyed(first, 'changed'), deadline: later }),
      );
      expect(failure).toBeInstanceOf(ThreadActReusedError);
    }),
  );
  it.effect(
    'two runs of one thread each commit their own first sequence, and each retry replays against its own run',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const first = keyed({ run: 'r1', seq: 1 }, 'r1-1');
      const second = keyed({ run: 'r2', seq: 1 }, 'r2-1');
      yield* transition(
        deps,
        THREAD,
        plan([message('e1', 'a')], () => ({ apply: true, result: 'r1' })),
        { key: first, deadline: later },
      );
      const made = yield* transition(
        deps,
        THREAD,
        plan([message('e2', 'b')], () => ({ apply: true, result: 'r2' })),
        { key: second, deadline: later },
      );
      expect(made).toEqual({ committed: 'r2' });
      expect(yield* transition(deps, THREAD, plan([message('e2', 'b')]), { key: second, deadline: later })).toEqual({ replayed: 'r2' });
      expect(yield* transition(deps, THREAD, plan([message('e1', 'a')]), { key: first, deadline: later })).toEqual({ replayed: 'r1' });
      expect(memory.held(THREAD).events).toHaveLength(2);
    }),
  );
  it.effect(
    'a revision moved between preparation and the unit prepares again under the same event ids',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      let moves = 1;
      memory.beforeUnit = Effect.sync(() => {
        if (moves-- > 0) memory.touchFold(THREAD);
      });
      const outcome = yield* transition(deps, THREAD, plan([message('e1', 'a')]), {
        key: keyed({ run: 'r', seq: 1 }, 'a'),
        deadline: later,
      });
      expect(outcome).toEqual({ committed: 'done' });
      expect(memory.units).toBe(2);
      expect(memory.held(THREAD).events.map((event) => event.id)).toEqual(['e1']);
    }),
  );
  it.effect(
    'a thread that moves under every preparation still commits once, on the retry it prepares inside its unit',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      memory.beforeUnit = Effect.sync(() => memory.touchFold(THREAD));
      const now = yield* Clock.currentTimeMillis;
      const outcome = yield* transition(deps, THREAD, plan([message('e1', 'a')]), {
        key: keyed({ run: 'r', seq: 1 }, 'a'),
        deadline: new Date(now + 200),
      });
      expect(outcome).toEqual({ committed: 'done' });
      expect(memory.units).toBe(2);
      expect(memory.held(THREAD).events.map((event) => event.id)).toEqual(['e1']);
    }),
  );
  it.effect(
    'a retry the deadline already passed answers stalled with nothing written',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      memory.beforeUnit = Effect.sync(() => memory.touchFold(THREAD));
      const outcome = yield* transition(deps, THREAD, plan([message('e1', 'a')]), {
        key: keyed({ run: 'r', seq: 1 }, 'a'),
        deadline: new Date(-1),
      });
      expect(outcome).toEqual({ stalled: 'none' });
      expect(memory.held(THREAD).events).toHaveLength(0);
    }),
  );
  it.effect(
    'a stale preparation re-enters the lane at the place it first took',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const places: ThreadLanePlace[] = [];
      const lane: ThreadJournalLaneFaces = {
        place: () => ({ at: 7 }),
        enter: (_threadId, place, work) => {
          places.push(place);
          return Effect.map(work, (ran) => ({ ran }));
        },
      };
      let moves = 1;
      memory.beforeUnit = Effect.sync(() => {
        if (moves-- > 0) memory.touchFold(THREAD);
      });
      yield* transition({ ...deps, lane }, THREAD, plan([message('e1', 'a')]), { key: keyed({ run: 'r', seq: 1 }, 'a'), deadline: later });
      expect(places).toEqual([{ at: 7 }, { at: 7 }]);
    }),
  );
  it.effect(
    'a first entry the lane never admits answers uncertain, because an earlier call under the key may still stand in the lane',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const key = keyed({ run: 'r', seq: 1 }, 'a');
      for (const stalled of ['none', 'uncertain'] as const) {
        const lane: ThreadJournalLaneFaces = { place: () => ({ at: 1 }), enter: () => Effect.succeed({ stalled }) };
        expect(yield* transition({ ...deps, lane }, THREAD, plan([message('e1', 'a')]), { key, deadline: later })).toEqual({
          stalled: 'uncertain',
          key,
        });
      }
      expect(memory.units).toBe(0);
    }),
  );
  it.effect(
    'a later entry the lane never admits answers none, because the stale attempt read no record under the key',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      let entries = 0;
      const lane: ThreadJournalLaneFaces = {
        place: () => ({ at: 1 }),
        enter: (_threadId, _place, work) =>
          entries++ === 0 ? Effect.map(work, (ran) => ({ ran })) : Effect.succeed({ stalled: 'none' as const }),
      };
      let moves = 1;
      memory.beforeUnit = Effect.sync(() => {
        if (moves-- > 0) memory.touchFold(THREAD);
      });
      const outcome = yield* transition({ ...deps, lane }, THREAD, plan([message('e1', 'a')]), {
        key: keyed({ run: 'r', seq: 1 }, 'a'),
        deadline: later,
      });
      expect(outcome).toEqual({ stalled: 'none' });
      expect(memory.held(THREAD).events).toHaveLength(0);
    }),
  );
  it.effect(
    'a redeclared plan commits the derived events under the same request key',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      let first = true;
      const outcome = yield* transition(
        deps,
        THREAD,
        plan([message('e1', 'draft')], () => {
          if (!first) return { apply: true, result: 'derived' };
          first = false;
          return { redeclare: [message('e1', 'derived')] };
        }),
        { key: keyed({ run: 'r', seq: 1 }, 'request'), deadline: later },
      );
      expect(outcome).toEqual({ committed: 'derived' });
      expect(memory.held(THREAD).events.map((event) => event.payload.entry)).toMatchObject([{ text: 'derived' }]);
      expect(memory.held(THREAD).transcript).toMatchObject([{ id: 'entry-e1', type: 'message', text: 'derived' }]);
    }),
  );
  it.effect(
    'a refused decision commits nothing and writes no record',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const key = keyed({ call: { namespace: 'answer:actor', id: 'k' } }, 'answer');
      expect(
        yield* transition(
          deps,
          THREAD,
          plan([message('e1', 'a')], () => ({ refuse: 'subject-changed' })),
          { key, deadline: later },
        ),
      ).toEqual({ refused: 'subject-changed' });
      expect(memory.held(THREAD).events).toHaveLength(0);
      expect(yield* transition(deps, THREAD, plan([message('e1', 'a')]), { key, deadline: later })).toEqual({ committed: 'done' });
    }),
  );
  it.effect(
    'a failing participant rolls back the whole unit, events and record included',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const key = keyed({ run: 'r', seq: 1 }, 'a');
      const failing = plan([message('e1', 'a')], () => ({
        apply: true,
        result: 'never',
        participants: () => Effect.fail(new ThreadCallBroke({ cause: new Error('usage write failed') })),
      }));
      expect(yield* Effect.flip(transition(deps, THREAD, failing, { key, deadline: later }))).toBeInstanceOf(ThreadCallBroke);
      expect(memory.held(THREAD).events).toHaveLength(0);
      expect(yield* transition(deps, THREAD, plan([message('e1', 'a')]), { key, deadline: later })).toEqual({ committed: 'done' });
    }),
  );
  it.effect(
    'a key tombstoned by deletion answers spent for its own request and reused for another',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const evidence: Evidence = { envelope: { namespace: 'spawn:parent', id: 'k' } };
      yield* transition(deps, THREAD, plan([]), { key: keyed(evidence, 'spawn'), deadline: later });
      const at = new Date('2026-09-29T13:00:00.000Z');
      memory.forget(THREAD, [{ evidence, at }]);
      memory.seed(makeAggregateStorage().row(THREAD));
      expect(yield* transition(deps, THREAD, plan([]), { key: keyed(evidence, 'spawn'), deadline: later })).toEqual({ spent: { at } });
      expect(yield* Effect.flip(transition(deps, THREAD, plan([]), { key: keyed(evidence, 'other'), deadline: later }))).toBeInstanceOf(
        ThreadActReusedError,
      );
    }),
  );
  it.effect(
    'a birth record replays its child for its own request, refuses another, and answers spent once its child is deleted',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const fork: Evidence = { call: { namespace: 'fork:source', id: 'k' } };
      const read = (key: Keyed) => readBirthRecord(deps.transitions, THREAD, key, undefined);
      expect(yield* read(keyed(fork, 'birth'))).toBeNull();
      yield* writeBirthRecord(deps.transitions, THREAD, keyed(fork, 'birth'), undefined);
      expect(yield* read(keyed(fork, 'birth'))).toEqual({ standing: THREAD });
      expect(yield* read(keyed(fork, 'another birth'))).toEqual({ reused: true });
      const at = new Date('2026-09-29T13:00:00.000Z');
      memory.forget(THREAD, [{ evidence: fork, at }]);
      expect(yield* read(keyed(fork, 'birth'))).toEqual({ spent: at });
      expect(yield* read(keyed(fork, 'another birth'))).toEqual({ reused: true });
    }),
  );
  it.effect(
    'a door-minted key older than the epoch with no record answers spent before the epoch and never runs',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      memory.epoch = new Date('2026-09-29T00:00:00.000Z');
      let ran = false;
      const old = '01900000-0000-7000-8000-000000000000';
      const outcome = yield* transition(
        deps,
        THREAD,
        plan([], () => {
          ran = true;
          return { apply: true, result: 'x' };
        }),
        {
          key: keyed({ call: { namespace: 'note:actor', id: old } }, 'n'),
          deadline: later,
        },
      );
      expect(outcome).toEqual({ spent: { at: 'before-epoch' } });
      expect(ran).toBe(false);
    }),
  );
  it.effect(
    'control folds nothing, and a standing envelope replays from its own row without its participant',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      let sent = 0;
      const key = keyed({ envelope: { namespace: 'message:sender', id: 'k' } }, 'send');
      const send = {
        decide: () =>
          Effect.succeed<Decision<string, undefined>>(
            sent > 0
              ? { replayed: 'sent' }
              : {
                  apply: true,
                  result: 'sent',
                  participants: () =>
                    Effect.sync(() => {
                      sent += 1;
                    }),
                },
          ),
      };
      expect(yield* control(deps, THREAD, send, key)).toEqual({ committed: 'sent' });
      expect(yield* control(deps, THREAD, send, key)).toEqual({ replayed: 'sent' });
      expect(sent).toBe(1);
      expect(memory.held(THREAD).events).toHaveLength(0);
    }),
  );
  it.effect(
    'a standing act whose plan answers a new act fails instead of running twice',
    Effect.fnUntraced(function* () {
      const { deps } = yield* world;
      const key = keyed({ envelope: { namespace: 'message:sender', id: 'standing' } }, 'send');
      yield* transition(deps, THREAD, plan([message('e1', 'start')]), { key, deadline: later });
      expect(yield* Effect.flip(transition(deps, THREAD, plan([message('e1', 'start')]), { key, deadline: later }))).toBeInstanceOf(
        ThreadStorageFailed,
      );
    }),
  );
  it.effect(
    'an inbox item already delivered replays through its own row on a lost answer',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      let delivered = false;
      const key = keyed({ inboxItem: 'item-1', run: 'run-1' }, 'deliver');
      const deliver = plan([message('e1', 'delivered')], () =>
        delivered
          ? { replayed: 'delivered' }
          : {
              apply: true,
              result: 'delivered',
              participants: () =>
                Effect.sync(() => {
                  delivered = true;
                }),
            },
      );
      expect(yield* transition(deps, THREAD, deliver, { key, deadline: later })).toEqual({ committed: 'delivered' });
      expect(yield* transition(deps, THREAD, deliver, { key, deadline: later })).toEqual({ replayed: 'delivered' });
      expect(memory.held(THREAD).events).toHaveLength(1);
    }),
  );
  it.effect(
    'a run ended with another status leaves the answer to the plan instead of a reused key',
    Effect.fnUntraced(function* () {
      const { deps } = yield* world;
      yield* transition(deps, THREAD, plan([]), { key: keyed({ runEnd: 'run-1', status: 'completed' }, 'end-ok'), deadline: later });
      const outcome = yield* transition(
        deps,
        THREAD,
        plan([], () => ({ refuse: 'ended-completed' })),
        {
          key: keyed({ runEnd: 'run-1', status: 'failed' }, 'end-failed'),
          deadline: later,
        },
      );
      expect(outcome).toEqual({ refused: 'ended-completed' });
    }),
  );
  it.effect(
    'transitionIn fails its coordinator unit when the thread moved since preparation',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const prepared = yield* prepareTransition(deps, THREAD, [message('e1', 'notice')]);
      memory.touchFold(THREAD);
      expect(
        yield* Effect.flip(transitionIn(deps, undefined, prepared, plan([message('e1', 'notice')]), keyed({ run: 'r', seq: 1 }, 'n'))),
      ).toBeInstanceOf(ThreadVersionStaleError);
    }),
  );
  it.effect(
    'a transitionIn whose participant fails leaves nothing of its unit behind',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      const prepared = yield* prepareTransition(deps, THREAD, [message('e1', 'notice')]);
      const failing = plan([message('e1', 'notice')], () => ({
        apply: true,
        result: 'never',
        participants: () => Effect.fail(new ThreadCallBroke({ cause: new Error('inbox insert failed') })),
      }));
      expect(yield* Effect.flip(transitionIn(deps, undefined, prepared, failing, keyed({ run: 'r', seq: 1 }, 'n')))).toBeInstanceOf(
        ThreadCallBroke,
      );
      expect(memory.held(THREAD).events).toHaveLength(0);
      expect(memory.held(THREAD).foldRev).toBe(0);
    }),
  );
  it.effect(
    'a context reading written outside the event path invalidates a prepared fold',
    Effect.fnUntraced(function* () {
      const { memory, deps } = yield* world;
      let moved = false;
      memory.beforeUnit = Effect.suspend(() => {
        if (moved) return Effect.void;
        moved = true;
        return memory.store.update(THREAD, { model: 'moved' });
      });
      expect(
        yield* transition(deps, THREAD, plan([message('e1', 'a')]), { key: keyed({ run: 'r', seq: 1 }, 'a'), deadline: later }),
      ).toEqual({ committed: 'done' });
      expect(memory.units).toBe(2);
      expect(memory.held(THREAD).row.model).toBe('moved');
    }),
  );
});

import { Clock, Effect } from 'effect';
import { actDigest, callParts, evidenceKey, INPUT_OPERATION, type Evidence, type Keyed, type TransitionOutcome } from '../keyed';
import type { ThreadMetadataRow, ThreadRow } from '../rows';
import type { ThreadMetadataChange } from '../state';
import { ThreadNotFoundError, type ThreadAtomicPatch } from '../storage/aggregate';
import { decodeThreadEventPayload, type ThreadEventRecord } from '../events';
import { foldThreadEvents, sealThreadEvents, threadPlacementSeed, type ThreadLogState, type ThreadSealedEvent } from '../ThreadEventDoor';
import { ThreadEventJournal, ThreadStore, ThreadTransitions, type ThreadTx, type ThreadWriteTx } from '../ThreadPorts';
import type { ThreadAggregateStorage } from '../storage/aggregate';
import { type ThreadBorderFailed, type ThreadPortFailure } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import {
  ThreadActReusedError,
  ThreadActSpentError,
  ThreadVersionStaleError,
  type ControlPlan,
  type Decision,
  type OwnedRecord,
  type Prepared,
  type RecordReading,
  type ThreadHold,
  type ThreadTransitionStorage,
  type ThreadVersion,
  type TransitionPlan,
} from './port';
import { ThreadJournalLane, type ThreadJournalLaneFaces } from './lane';
import type { ThreadEventLogStorage } from '../storage/eventLog';
import { ThreadEntryKinds, type ThreadEntryReader } from '../../transcript/kinds';
export type TransitionDeps<TTx, TWrite extends TTx = TTx> = {
  readonly store: ThreadAggregateStorage<TTx, TWrite>;
  readonly log: ThreadEventLogStorage<TTx, TWrite>;
  readonly transitions: ThreadTransitionStorage<TTx, TWrite>;
  readonly lane: ThreadJournalLaneFaces;
  readonly kinds: ThreadEntryReader;
};
export type TransitionCall = {
  readonly key: Keyed;
  readonly deadline: Date;
};
export const TRANSITION_PATIENCE_MS = 30_000;
export const transitionDeps: Effect.Effect<
  TransitionDeps<ThreadTx, ThreadWriteTx>,
  never,
  ThreadStore | ThreadEventJournal | ThreadTransitions | ThreadEntryKinds
> = Effect.gen(function* () {
  return {
    store: yield* ThreadStore,
    log: yield* ThreadEventJournal,
    transitions: yield* ThreadTransitions,
    lane: yield* ThreadJournalLane,
    kinds: yield* ThreadEntryKinds,
  };
});
export function answerOf<A>(threadId: string, outcome: TransitionOutcome<A>): Effect.Effect<A, ThreadStorageFailed | ThreadActSpentError> {
  if ('committed' in outcome) return Effect.succeed(outcome.committed);
  if ('replayed' in outcome) return Effect.succeed(outcome.replayed);
  if ('refused' in outcome) return Effect.succeed(outcome.refused);
  if ('spent' in outcome) return Effect.fail(new ThreadActSpentError({ threadId, at: outcome.spent.at }));
  if (outcome.stalled === 'uncertain') {
    return Effect.fail(
      new ThreadStorageFailed({
        call: 'transition',
        cause: new Error(
          `Thread ${threadId}: the act under ${evidenceKey(outcome.key.evidence)} stopped before its record answered, so whether it committed is unknown; send it again under the same key, and its record answers.`,
        ),
      }),
    );
  }
  return Effect.fail(
    new ThreadStorageFailed({
      call: 'transition',
      cause: new Error(`Thread ${threadId}: the transition was not recorded before its deadline.`),
    }),
  );
}
export function transitionNow<A, TWrite extends TTx, E = ThreadBorderFailed, TTx = unknown>(
  deps: TransitionDeps<TTx, TWrite>,
  threadId: string,
  plan: TransitionPlan<A, TWrite, E>,
  key: Keyed,
): Effect.Effect<TransitionOutcome<A>, E | ThreadPortFailure> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    transition(deps, threadId, plan, { key, deadline: new Date(now + TRANSITION_PATIENCE_MS) }),
  );
}
type Looked<A> =
  | {
      readonly outcome: TransitionOutcome<A>;
    }
  | {
      readonly act: 'new' | 'standing';
    };
type Step<A> =
  | {
      readonly outcome: TransitionOutcome<A>;
    }
  | {
      readonly stale: true;
    }
  | {
      readonly redeclare: readonly ThreadSealedEvent[];
    };
export const prepareTransition = Effect.fnUntraced(function* <TTx, TWrite extends TTx>(
  deps: TransitionDeps<TTx, TWrite>,
  threadId: string,
  declaration: readonly ThreadSealedEvent[] | ((row: ThreadRow) => readonly ThreadSealedEvent[]),
  tx?: TWrite,
): Effect.fn.Return<Prepared, ThreadPortFailure> {
  const prepared = yield* deps.transitions.readAt(
    threadId,
    Effect.fnUntraced(function* (at) {
      const declared = typeof declaration === 'function' ? declaration(at.row) : declaration;
      yield* replayable(deps.kinds, declared);
      const seed = yield* threadPlacementSeed(deps.store, threadId, declared, at.tx);
      return { threadId, declared, row: at.row, state: foldDeclared(at.row, seed, declared, at.version.head), version: at.version };
    }),
    tx,
  );
  if (prepared === undefined) return yield* Effect.fail(new ThreadNotFoundError(threadId));
  return prepared;
});
export const transition = Effect.fnUntraced(function* <A, TWrite extends TTx, E = ThreadBorderFailed, TTx = unknown>(
  deps: TransitionDeps<TTx, TWrite>,
  threadId: string,
  plan: TransitionPlan<A, TWrite, E>,
  call: TransitionCall,
): Effect.fn.Return<TransitionOutcome<A>, E | ThreadPortFailure> {
  let declared = plan.declared;
  const place = deps.lane.place();
  const transitions = deps.transitions;
  for (let attempt = 0; ; attempt += 1) {
    const programmed = attempt === 0 && transitions.programAt !== undefined;
    const outside = prepareTransition(deps, threadId, declared).pipe(
      Effect.catchIf(
        (failure): failure is ThreadVersionStaleError => failure instanceof ThreadVersionStaleError,
        () => Effect.succeed(null),
      ),
    );
    const ahead = attempt === 0 && !programmed ? yield* outside : null;
    const interactive = (held: Prepared | null) =>
      deps.transitions.writeAt(threadId, (at) =>
        Effect.flatMap(held === null ? prepareTransition(deps, threadId, declared, at.tx) : Effect.succeed(held), (prepared) =>
          applyPrepared(deps, at, prepared, plan, call.key, true),
        ),
      );
    const admitted = yield* deps.lane.enter(
      threadId,
      place,
      !programmed || transitions.programAt === undefined
        ? interactive(ahead)
        : Effect.flatMap(outside, (fresh) =>
            fresh === null
              ? interactive(null)
              : Effect.flatMap(
                  transitions.programAt!(threadId, fresh, evidenceKey(call.key.evidence), (at) =>
                    applyPrepared(deps, at, fresh, plan, call.key, true),
                  ),
                  (ran) => (ran === null ? interactive(fresh) : Effect.succeed(ran)),
                ),
          ),
    );
    if ('stalled' in admitted) {
      return admitted.stalled === 'none' && attempt > 0 ? { stalled: 'none' as const } : { stalled: 'uncertain' as const, key: call.key };
    }
    const step = admitted.ran;
    if (step === undefined) return yield* Effect.fail(new ThreadNotFoundError(threadId));
    if ('outcome' in step) return step.outcome;
    if ('redeclare' in step) {
      if ((yield* Clock.currentTimeMillis) >= call.deadline.getTime()) return { stalled: 'none' as const };
      declared = step.redeclare;
    }
  }
});
export const transitionIn = Effect.fnUntraced(function* <A, TWrite extends TTx, E = ThreadBorderFailed, TTx = unknown>(
  deps: TransitionDeps<TTx, TWrite>,
  tx: TWrite,
  prepared: Prepared,
  plan: TransitionPlan<A, TWrite, E>,
  key: Keyed,
): Effect.fn.Return<TransitionOutcome<A>, E | ThreadPortFailure> {
  const step = yield* deps.transitions.writeAtIn(prepared.threadId, (at) => applyPrepared(deps, at, prepared, plan, key, false), tx);
  if (step === undefined) return yield* Effect.fail(new ThreadNotFoundError(prepared.threadId));
  if ('outcome' in step) return step.outcome;
  return yield* Effect.fail(new ThreadVersionStaleError({ threadId: prepared.threadId }));
});
export function control<A, TWrite extends TTx, E = ThreadBorderFailed, TTx = unknown>(
  deps: TransitionDeps<TTx, TWrite>,
  threadId: string,
  plan: ControlPlan<A, TWrite, E>,
  key: Keyed,
): Effect.Effect<TransitionOutcome<A>, E | ThreadPortFailure> {
  return Effect.flatMap(controlIfPresent(deps, threadId, plan, key), (outcome) =>
    outcome === undefined ? Effect.fail(new ThreadNotFoundError(threadId)) : Effect.succeed(outcome),
  );
}
export function controlIfPresent<A, TWrite extends TTx, E = ThreadBorderFailed, TTx = unknown>(
  deps: TransitionDeps<TTx, TWrite>,
  threadId: string,
  plan: ControlPlan<A, TWrite, E>,
  key: Keyed,
): Effect.Effect<TransitionOutcome<A> | undefined, E | ThreadPortFailure> {
  return deps.transitions.writeAt(
    threadId,
    Effect.fnUntraced(function* (at) {
      const looked = yield* lookup<A, TTx, TWrite, E>(deps, at, plan.owned, key);
      if ('outcome' in looked) return looked.outcome;
      const decision = yield* plan.decide(at.row, at.tx);
      if ('replayed' in decision) return { replayed: decision.replayed } as TransitionOutcome<A>;
      if ('refuse' in decision) return { refused: decision.refuse } as TransitionOutcome<A>;
      if (looked.act === 'standing') return yield* Effect.fail(standing(threadId, key.evidence));
      if ('redeclare' in decision || (decision.events !== undefined && decision.events.length > 0)) {
        return yield* Effect.fail(
          new ThreadStorageFailed({ call: 'control', cause: new Error('A control transition appends no events.') }),
        );
      }
      if (decision.patch !== undefined && Object.keys(decision.patch).length > 0) {
        yield* deps.store.update(threadId, decision.patch, at.tx);
      }
      if (decision.participants) yield* decision.participants(at.tx);
      yield* record(deps, at, plan.owned, key, {
        digest: key.digest,
        result: decision.result,
      });
      return { committed: decision.result } as TransitionOutcome<A>;
    }),
  );
}
const applyPrepared = Effect.fnUntraced(function* <A, TTx, TWrite extends TTx, E>(
  deps: TransitionDeps<TTx, TWrite>,
  at: ThreadHold<TWrite>,
  prepared: Prepared,
  plan: TransitionPlan<A, TWrite, E>,
  key: Keyed,
  own: boolean,
): Effect.fn.Return<Step<A>, E | ThreadPortFailure> {
  const looked = yield* lookup<A, TTx, TWrite, E>(deps, at, plan.owned, key);
  if ('outcome' in looked) return { outcome: looked.outcome } as Step<A>;
  if (looked.act === 'new' && !sameVersion(at.version, prepared.version)) return { stale: true } as Step<A>;
  const decision: Decision<A, TWrite, E> = yield* plan.decide(
    { row: { ...prepared.row, ...at.row }, state: prepared.state, version: at.version },
    at.tx,
  );
  if ('replayed' in decision) return { outcome: { replayed: decision.replayed } } as Step<A>;
  if ('refuse' in decision) return { outcome: { refused: decision.refuse } } as Step<A>;
  if (looked.act === 'standing') return yield* Effect.fail(standing(prepared.threadId, key.evidence));
  if ('redeclare' in decision) return { redeclare: decision.redeclare } as Step<A>;
  const threadId = prepared.threadId;
  const head = at.version.head;
  const published = own ? plan.published : undefined;
  if (published !== undefined) yield* deps.transitions.opened(threadId, at.tx);
  const extra = decision.events && decision.events.length > 0 ? sealThreadEvents(decision.events) : [];
  if (extra.length > 0) yield* replayable(deps.kinds, extra);
  const declared = [...prepared.declared, ...extra];
  const state =
    extra.length === 0
      ? prepared.state
      : foldEvents(
          withSeed(prepared.state, yield* threadPlacementSeed(deps.store, threadId, extra, at.tx)),
          extra,
          head + prepared.declared.length,
        );
  for (const [index, { id, body }] of declared.entries()) {
    const appended = yield* deps.log.append({ threadId, id, kind: body.kind, payload: body.payload }, at.tx);
    if (appended.position !== head + index + 1) {
      return yield* Effect.fail(
        new ThreadStorageFailed({
          call: 'transition',
          cause: new Error(
            `Thread ${threadId}: the prepared fold expected position ${head + index + 1} and the fact landed at ${appended.position}, so a writer outside the transition moved the log under a validated version.`,
          ),
        }),
      );
    }
  }
  const fold: ThreadAtomicPatch = { ...foldPatch(prepared.row, state), ...(decision.patch ?? {}) };
  const stamped = new Date(yield* Clock.currentTimeMillis);
  if (Object.keys(fold).length > 0 || declared.length > 0) {
    yield* deps.transitions.writeFold(
      threadId,
      { fold, standing: head, head: head + declared.length, base: prepared.row.history, at: stamped },
      at.tx,
    );
  }
  if (decision.participants) yield* decision.participants(at.tx);
  yield* record(deps, at, plan.owned, key, {
    digest: key.digest,
    result: decision.result,
  });
  if (published !== undefined) {
    const shown = decision.participants === undefined || decision.participantsUnseen === true ? shownFold(fold, stamped) : null;
    const appended =
      shown === null || !recordsUnseen(key.evidence)
        ? null
        : { from: head, records: yield* journalForm(deps.kinds, threadId, head, declared), thread: shown };
    yield* deps.transitions.revised(threadId, at.tx, (revision) =>
      published(appended === null ? { kind: 'moved', threadId } : { kind: 'appended', threadId, revision, ...appended }),
    );
  }
  return { outcome: { committed: decision.result } } as Step<A>;
});
const SHOWN_COLUMNS: ReadonlySet<string> = new Set(['contextReading', 'pendingInteraction']);
const FOLDED_ONLY: ReadonlySet<string> = new Set(['history', 'covered', 'placements', 'cacheObservations']);
function shownFold(fold: ThreadAtomicPatch, stamped: Date): ThreadMetadataChange | null {
  const keys = Object.keys(fold);
  if (keys.length === 0) return {};
  const shown: Record<string, unknown> = { updatedAt: stamped };
  for (const key of keys) {
    const value = (fold as Readonly<Record<string, unknown>>)[key];
    if (value === undefined || FOLDED_ONLY.has(key)) continue;
    if (!SHOWN_COLUMNS.has(key)) return null;
    shown[key] = value === null ? null : JSON.parse(JSON.stringify(value));
  }
  return shown as ThreadMetadataChange;
}
function recordsUnseen(evidence: Evidence): boolean {
  if ('call' in evidence) return callParts(evidence.call).operation !== INPUT_OPERATION;
  return !('envelope' in evidence) && !('owned' in evidence);
}
function journalForm(
  kinds: ThreadEntryReader,
  threadId: string,
  head: number,
  declared: readonly ThreadSealedEvent[],
): Effect.Effect<readonly ThreadEventRecord[], ThreadStorageFailed> {
  return Effect.try({
    try: () =>
      declared.map(({ id, body }, index) => ({
        threadId,
        position: head + index + 1,
        id,
        kind: body.kind,
        payload: decodeThreadEventPayload(kinds, JSON.parse(JSON.stringify(body.payload))),
      })),
    catch: (cause) => new ThreadStorageFailed({ call: 'transition', cause }),
  });
}
const lookup = Effect.fnUntraced(function* <A, TTx, TWrite extends TTx, E>(
  deps: TransitionDeps<TTx, TWrite>,
  at: ThreadHold<TWrite>,
  owned: OwnedRecord<TWrite, E> | undefined,
  key: Keyed,
): Effect.fn.Return<Looked<A>, E | ThreadPortFailure> {
  const reading: RecordReading = yield* readRecord(deps, at, owned, key.evidence);
  switch (reading.kind) {
    case 'absent':
    case 'decided':
      return { act: 'new' as const };
    case 'before-epoch':
      return { outcome: { spent: { at: 'before-epoch' as const } } };
    case 'standing':
      if (reading.digest !== key.digest) return yield* reused(at.row, key.evidence);
      return { act: 'standing' as const };
    case 'present':
      if (reading.digest !== key.digest) return yield* reused(at.row, key.evidence);
      return { outcome: { replayed: reading.result as A } };
    case 'spent':
      if (reading.digest !== key.digest) return yield* reused(at.row, key.evidence);
      return { outcome: { spent: { at: reading.at } } };
  }
});
function readRecord<TTx, TWrite extends TTx, E>(
  deps: TransitionDeps<TTx, TWrite>,
  at: ThreadHold<TWrite>,
  owned: OwnedRecord<TWrite, E> | undefined,
  evidence: Evidence,
): Effect.Effect<RecordReading, E | ThreadPortFailure> {
  if ('owned' in evidence) return owned ? owned.read(at.tx) : Effect.fail(ownerless(at.row.id));
  return deps.transitions.readRecord(at.row.id, evidence, at.tx);
}
function record<TTx, TWrite extends TTx, E>(
  deps: TransitionDeps<TTx, TWrite>,
  at: ThreadHold<TWrite>,
  owned: OwnedRecord<TWrite, E> | undefined,
  key: Keyed,
  write: {
    digest: string;
    result: unknown;
  },
): Effect.Effect<void, E | ThreadPortFailure> {
  if ('owned' in key.evidence) return owned ? owned.write(write, at.tx) : Effect.fail(ownerless(at.row.id));
  return deps.transitions.writeRecord(at.row.id, key.evidence, write, at.tx);
}
function standing(threadId: string, evidence: Evidence): ThreadStorageFailed {
  return new ThreadStorageFailed({
    call: 'transition',
    cause: new Error(
      `Thread ${threadId}: the act under ${evidenceKey(evidence)} already stands, and its plan answered a new act instead of replaying it from its own row.`,
    ),
  });
}
function ownerless(threadId: string): ThreadStorageFailed {
  return new ThreadStorageFailed({
    call: 'transition',
    cause: new Error(`Thread ${threadId}: an owned key needs its coordinator's record participant, and the plan carried none.`),
  });
}
function reused(row: ThreadMetadataRow, evidence: Evidence): Effect.Effect<never, ThreadActReusedError> {
  return Effect.fail(new ThreadActReusedError({ threadId: row.id, evidence }));
}
export type BirthSettled =
  | {
      readonly standing: string | null;
    }
  | {
      readonly spent: Date | 'before-epoch';
    }
  | {
      readonly reused: true;
    }
  | {
      readonly taken: true;
    };
export function readBirthRecord<TTx, TWrite extends TTx>(
  transitions: ThreadTransitionStorage<TTx, TWrite>,
  childId: string,
  key: Keyed,
  tx?: TTx,
): Effect.Effect<BirthSettled | null, ThreadPortFailure> {
  return Effect.map(transitions.readRecord(childId, key.evidence, tx), (reading): BirthSettled | null => {
    switch (reading.kind) {
      case 'absent':
        return null;
      case 'decided':
        return { standing: null };
      case 'before-epoch':
        return { spent: 'before-epoch' };
      case 'standing':
        return reading.digest === key.digest ? { standing: null } : { reused: true };
      case 'present':
        if (reading.digest !== key.digest) return { reused: true };
        return { standing: typeof reading.result === 'string' ? reading.result : null };
      case 'spent':
        return reading.digest === key.digest ? { spent: reading.at } : { reused: true };
    }
  });
}
export function writeBirthRecord<TTx, TWrite extends TTx>(
  transitions: ThreadTransitionStorage<TTx, TWrite>,
  holderId: string,
  key: Keyed,
  tx: TWrite,
  childId: string = holderId,
): Effect.Effect<void, ThreadPortFailure> {
  return transitions.writeRecord(holderId, key.evidence, { digest: key.digest, result: childId }, tx);
}
export function sameVersion(left: ThreadVersion, right: ThreadVersion): boolean {
  return left.foldRev === right.foldRev && left.head === right.head && left.inheritRev === right.inheritRev;
}
function replayable(kinds: ThreadEntryReader, declared: readonly ThreadSealedEvent[]): Effect.Effect<void, ThreadStorageFailed> {
  return Effect.try({
    try: () => {
      for (const { body } of declared) decodeThreadEventPayload(kinds, body.payload);
    },
    catch: (cause) => new ThreadStorageFailed({ call: 'transition', cause }),
  });
}
export function seedFold(seed: readonly ThreadSealedEvent[], after: number): ThreadAtomicPatch {
  const state = foldEvents(
    { history: [], transcript: [], contextReading: null, placements: [], cacheObservations: [], covered: null },
    seed,
    after,
  );
  return {
    ...(state.history.length > 0 ? { history: state.history, covered: state.covered } : {}),
    ...(state.placements.length > 0 ? { placements: state.placements } : {}),
  };
}
function foldDeclared(
  row: ThreadRow,
  seed: ThreadLogState['transcript'],
  declared: readonly ThreadSealedEvent[],
  head: number,
): ThreadLogState {
  return foldEvents(
    { history: row.history, transcript: seed, contextReading: row.contextReading, placements: [], cacheObservations: [], covered: null },
    declared,
    head,
  );
}
function foldEvents(state: ThreadLogState, events: readonly ThreadSealedEvent[], after: number): ThreadLogState {
  if (events.length === 0) return state;
  return {
    ...foldThreadEvents(
      state,
      events.map(({ body }) => body),
      after,
    ),
    covered: { from: state.covered?.from ?? after, through: after + events.length },
  };
}
function withSeed(state: ThreadLogState, seed: ThreadLogState['transcript']): ThreadLogState {
  const held = new Set(state.transcript.map((entry) => entry.id));
  const missing = seed.filter((entry) => !held.has(entry.id));
  return missing.length === 0 ? state : { ...state, transcript: [...state.transcript, ...missing] };
}
function foldPatch(row: ThreadRow, state: ThreadLogState): ThreadAtomicPatch {
  return {
    ...(state.history !== row.history ? { history: state.history, covered: state.covered } : {}),
    ...(state.placements.length > 0 ? { placements: state.placements } : {}),
    ...(state.contextReading !== row.contextReading ? { contextReading: state.contextReading } : {}),
    ...(state.cacheObservations.length > 0 ? { cacheObservations: state.cacheObservations } : {}),
  };
}

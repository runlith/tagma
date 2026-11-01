import { Effect } from 'effect';
import type { JournalRuns } from '@runlith/agent/thread/transport/contract';
import type { HarnessCut, HarnessCutAsk, HarnessCutMaking, HarnessModelChoice } from '@runlith/tagma/adapter/harness';
import { cutArgv, harnessArgv, harnessRoot } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessSession } from '../../threads/contract/wire/harness/session.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { nativeRows, thread } from '../../threads/store/kernel.js';
import { declareHistory } from '../../threads/store/seat.js';
import { terminalHistory } from '../birth/seat.js';
import type { SessionObservations } from '../contract/service/observations.js';
import type { HarnessSessionStore, SessionChange } from '../store/sessions.js';
import { accountKey, type CutPoint, type LaunchedCut, type VendorSessionRow, type VendorTurns } from '../store/turns.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { HarnessPlace } from './launch.js';
import { cutRoot, type CutRootAnswer } from './prepareRoot.js';
import type { Carrying, SessionCarrying } from './carry.js';

type Prepared = Extract<HarnessCutMaking, { readonly _tag: 'Prepare' }>;

export type Alignment =
  | { readonly _tag: 'Keep' }
  | { readonly _tag: 'Fresh'; readonly reason: string | null; readonly replaced: string | null }
  | {
      readonly _tag: 'Carry';
      readonly root: string;
      readonly replaced: string | null;
      readonly from: string;
      readonly into: string;
    }
  | {
      readonly _tag: 'Cut';
      readonly ask: HarnessCutAsk;
      readonly making: HarnessCutMaking;
      readonly at: string | null;
      readonly own: boolean;
    };

export type AlignmentFacts = {
  readonly root: string | null;
  readonly plain: boolean;
  readonly cut: HarnessCut | undefined;
  readonly carries: boolean;
  readonly uncarried: string | null;
  readonly header: VendorSessionRow | null;
  readonly account: string | null;
  readonly point: CutPoint;
  readonly unmapped: boolean;
  readonly kept: number;
};

export const ALIGNMENT_WORDS = {
  account: 'The CLI session belongs to another account, so the thread’s kept turns were handed to a fresh session.',
  uncarried: (reason: string) =>
    `The CLI session could not be carried to this account’s folder (${reason}); the kept turns were handed to a fresh session.`,
  unmapped: 'The CLI session predates the turn map, so its rewound turns could not be cut; the kept turns were handed to a fresh session.',
  uncut: 'The CLI session cannot be cut where the rewound turns begin, so the kept turns were handed to a fresh session.',
  refused: (reason: string) => `The CLI could not cut its session (${reason}); the kept turns were handed to a fresh session.`,
} as const;

const fresh = (reason: string | null, replaced: string | null): Alignment => ({ _tag: 'Fresh', reason, replaced });

export const alignmentOf = ({
  root,
  plain,
  cut,
  carries,
  uncarried,
  header,
  account,
  point,
  unmapped,
  kept,
}: AlignmentFacts): Alignment => {
  const origin = header?.origin ?? null;
  const seeded = (reason: string) => (kept > 0 ? reason : null);
  const elsewhere = (session: string): Alignment => {
    const from = header?.account ?? null;
    if (carries && uncarried === null && from !== null && account !== null)
      return { _tag: 'Carry', root: session, replaced: header?.replaced?.root ?? null, from, into: account };
    return fresh(seeded(uncarried === null ? ALIGNMENT_WORDS.account : ALIGNMENT_WORDS.uncarried(uncarried)), null);
  };
  if (origin !== null) {
    if (point._tag === 'Fresh') return fresh(cut?.point == null ? null : seeded(ALIGNMENT_WORDS.uncut), null);
    const ask = point._tag === 'Cut' ? { root: origin.root, address: point.address } : origin;
    const making = (ask.address === null ? cut?.whole : cut?.point) ?? null;
    if (making === null || (plain && making._tag !== 'Prepare')) return fresh(null, null);
    if (header!.account !== account) return elsewhere(origin.root);
    return { _tag: 'Cut', ask, making, at: point._tag === 'Cut' ? point.run : null, own: false };
  }
  if (plain) return { _tag: 'Keep' };
  if (root === null) return fresh(null, null);
  const making = cut?.point ?? null;
  if (unmapped) return fresh(making === null ? null : seeded(ALIGNMENT_WORDS.unmapped), root);
  if (header !== null && header.account !== account) return elsewhere(root);
  if (point._tag === 'None') return { _tag: 'Keep' };
  if (point._tag === 'Fresh') return fresh(making === null ? null : seeded(ALIGNMENT_WORDS.uncut), root);
  if (making === null) return fresh(null, root);
  return { _tag: 'Cut', ask: { root, address: point.address }, making, at: point.run, own: true };
};

const stale = (alignment: Alignment): boolean =>
  (alignment._tag === 'Cut' && alignment.own) || (alignment._tag === 'Fresh' && alignment.replaced !== null);

const sameCut = (alignment: Alignment, cut: { readonly root: string; readonly at: string | null; readonly own: boolean }): boolean =>
  alignment._tag === 'Cut' && alignment.own === cut.own && alignment.ask.root === cut.root && alignment.at === cut.at;

export type AlignAnswer =
  | { readonly _tag: 'Aligned'; readonly facet: ExternalSession }
  | { readonly _tag: 'Gone' }
  | { readonly _tag: 'Uncertain'; readonly reason: string };

export type CutPreparing = {
  readonly terminals: Terminals['Service'];
  readonly writing: TerminalWriting['Service'];
  readonly records: ExecutionRecords['Service'];
  readonly discharge: Discharge['Service'];
  readonly access: Environments['Service'];
};

export type SessionAlignment = {
  readonly writes: WriteSet;
  readonly align: (
    threadId: string,
    sessionId: string,
    place: HarnessPlace,
    cwd: string,
    choice: HarnessModelChoice | undefined,
  ) => Effect.Effect<AlignAnswer, HarnessFailure>;
  readonly due: (threadId: string) => Effect.Effect<boolean, HarnessFailure>;
  readonly taken: (unit: WriteUnit<'machine'>, threadId: string, run: string, address: string | null) => Effect.Effect<void, StoreFailure>;
  readonly bound: (unit: WriteUnit<'machine'>, threadId: string, facet: ExternalSession) => Effect.Effect<ExternalSession, HarnessFailure>;
};

type Decided =
  | { readonly _tag: 'Gone' }
  | { readonly _tag: 'Again' }
  | { readonly _tag: 'Aligned'; readonly facet: ExternalSession; readonly reason: string | null }
  | ({ readonly _tag: 'Carry' } & Carrying)
  | {
      readonly _tag: 'Prepare';
      readonly adapter: HarnessAdapter;
      readonly ask: HarnessCutAsk;
      readonly making: Prepared;
      readonly at: string | null;
      readonly own: boolean;
    };

const GONE: Decided = { _tag: 'Gone' };
const AGAIN: Decided = { _tag: 'Again' };

export const makeSessionAlignment = (
  store: HarnessSessionStore,
  db: StoreDb<'machine'>,
  turns: VendorTurns,
  journal: JournalRuns,
  observations: SessionObservations['Service'],
  preparing: CutPreparing,
  carrying: SessionCarrying,
  ownerId: string,
  adapters: HarnessAdapters['Service'],
): SessionAlignment => {
  const aligning = writes('SessionAlignment.align', [nativeRows], turns.writes);

  const held = (facet: ExternalSession, sessionId: string): HarnessSession | null => {
    const session = facet.session;
    return session === undefined || session.id !== sessionId || session.ownerId !== ownerId || session.state === 'ended' ? null : session;
  };

  const rowOf = (facet: ExternalSession) => adapters.runningRow(facet);

  const judged = Effect.fnUntraced(function* (
    threadId: string,
    facet: ExternalSession,
    account: string | null,
    root: string | null,
    unit?: Unit<'machine'>,
    uncarried: string | null = null,
  ) {
    const adapter = yield* rowOf(facet);
    const header = yield* turns.session(threadId, unit);
    const kept = yield* Effect.mapError(journal.kept(threadId, unit), threadCallFailed);
    const rewound = header === null ? yield* Effect.mapError(journal.rewound(threadId, unit), threadCallFailed) : [];
    const cut = header === null ? [] : yield* Effect.mapError(journal.cut(threadId, unit), threadCallFailed);
    const point = yield* turns.point(threadId, cut, null, unit);
    const launch = adapter.launch;
    const alignment = alignmentOf({
      root,
      plain: facet.plain === true,
      cut: launch?.cut,
      carries: launch?.carry !== undefined && facet.plain !== true,
      uncarried,
      header,
      account,
      point,
      unmapped: header === null && rewound.length > 0,
      kept: kept.length,
    });
    return { adapter, header, kept, alignment };
  });

  const freshly = Effect.fnUntraced(function* (
    threadId: string,
    adapter: HarnessAdapter,
    facet: ExternalSession,
    session: HarnessSession,
    unit: WriteUnit<'machine'>,
    choice: HarnessModelChoice | undefined,
    alignment: Extract<Alignment, { readonly _tag: 'Fresh' }>,
    kept: readonly string[],
  ): Effect.fn.Return<SessionChange<Decided>, HarnessFailure> {
    if (alignment.replaced !== null) {
      const cut = yield* Effect.mapError(journal.cut(threadId, unit), threadCallFailed);
      yield* turns.replace(unit, threadId, alignment.replaced, cut);
    }
    yield* turns.based(unit, threadId, kept);
    yield* turns.established(unit, threadId, accountKey(session.account));
    const argv = yield* harnessArgv(adapter, null, session.id, session.prompt, choice, facet.permissionMode);
    const seeded = kept.length > 0 && facet.plain !== true;
    const aligned: ExternalSession = {
      ...facet,
      sessionKey: null,
      observation: { ...facet.observation, binding: { ...facet.observation.binding, rootKey: null } },
      session: seeded ? { ...session, argv, seed: true } : { ...session, argv },
    };
    const decided: Decided = { _tag: 'Aligned', facet: aligned, reason: alignment.reason };
    return { facet: aligned, value: decided };
  });

  const decide = Effect.fnUntraced(function* (
    threadId: string,
    sessionId: string,
    facet: ExternalSession,
    unit: WriteUnit<'machine'>,
    choice: HarnessModelChoice | undefined,
    uncarried: string | null,
  ): Effect.fn.Return<SessionChange<Decided>, HarnessFailure> {
    const session = held(facet, sessionId);
    if (session === null) return { facet, value: GONE };
    const account = accountKey(session.account);
    yield* declareHistory(db, unit, threadId, terminalHistory(yield* rowOf(facet), facet.plain === true));
    const { adapter, header, kept, alignment } = yield* judged(threadId, facet, account, facet.sessionKey, unit, uncarried);
    if (alignment._tag === 'Carry') {
      const { root, replaced, from, into } = alignment;
      const carry: Decided = { _tag: 'Carry', adapter, provider: session.account!.provider, root, replaced, from, into };
      return { facet, value: carry };
    }
    if (alignment._tag === 'Keep') {
      if (facet.plain !== true) {
        if (header === null) {
          yield* turns.based(unit, threadId, kept);
          yield* turns.established(unit, threadId, account);
        } else yield* turns.launched(unit, threadId, account);
      }
      const decided: Decided = { _tag: 'Aligned', facet, reason: null };
      return { facet, value: decided };
    }
    if (alignment._tag === 'Fresh') return yield* freshly(threadId, adapter, facet, session, unit, choice, alignment, kept);
    const { making, ask, at, own } = alignment;
    if (making._tag === 'Prepare') {
      const decided: Decided = { _tag: 'Prepare', adapter, ask, making, at, own };
      return { facet, value: decided };
    }
    const argv = yield* cutArgv(adapter, making, ask, session.id, session.prompt, choice, facet.permissionMode);
    const aligned: ExternalSession = {
      ...facet,
      session: { ...session, argv, cut: { root: ask.root, into: session.id, at, own, rows: making.rows } },
    };
    const decided: Decided = { _tag: 'Aligned', facet: aligned, reason: null };
    return { facet: aligned, value: decided };
  });

  const commit = Effect.fnUntraced(function* (
    threadId: string,
    sessionId: string,
    facet: ExternalSession,
    unit: WriteUnit<'machine'>,
    choice: HarnessModelChoice | undefined,
    decided: Extract<Decided, { readonly _tag: 'Prepare' }>,
    answer: Extract<CutRootAnswer, { readonly _tag: 'Cut' | 'Refused' }>,
  ): Effect.fn.Return<SessionChange<Decided>, HarnessFailure> {
    const session = held(facet, sessionId);
    if (session === null) return { facet, value: GONE };
    const account = accountKey(session.account);
    const { adapter, kept, alignment } = yield* judged(threadId, facet, account, facet.sessionKey, unit);
    if (!sameCut(alignment, { root: decided.ask.root, at: decided.at, own: decided.own })) return { facet, value: AGAIN };
    if (answer._tag === 'Refused')
      return yield* freshly(
        threadId,
        adapter,
        facet,
        session,
        unit,
        choice,
        { _tag: 'Fresh', reason: ALIGNMENT_WORDS.refused(answer.reason), replaced: decided.own ? decided.ask.root : null },
        kept,
      );
    if (decided.at !== null) yield* turns.cut(unit, threadId, decided.own ? decided.ask.root : null, decided.at);
    if (answer.addresses !== 'copied') yield* turns.addressed(unit, threadId, answer.addresses === 'unaddressed' ? null : answer.addresses);
    yield* turns.established(unit, threadId, account);
    const argv = yield* harnessArgv(adapter, answer.root.id, session.id, session.prompt, choice, facet.permissionMode);
    const aligned: ExternalSession = { ...facet, sessionKey: answer.root.id, session: { ...session, argv } };
    const committed: Decided = { _tag: 'Aligned', facet: aligned, reason: null };
    return { facet: aligned, value: committed };
  });

  const moved = Effect.fnUntraced(function* (
    unit: WriteUnit<'machine'>,
    threadId: string,
    facet: ExternalSession,
    carried: Extract<Decided, { readonly _tag: 'Carry' }>,
  ): Effect.fn.Return<SessionChange<void>, HarnessFailure> {
    if ((yield* turns.session(threadId, unit))?.account === carried.from) yield* turns.launched(unit, threadId, carried.into);
    return { facet, value: undefined };
  });

  const noted = Effect.fnUntraced(function* (threadId: string, facet: ExternalSession, reason: string | null) {
    if (reason !== null) yield* observations.notedWords(threadId, 'history-seeded', reason);
    const aligned: AlignAnswer = { _tag: 'Aligned', facet };
    return aligned;
  });

  const align = Effect.fnUntraced(function* (
    threadId: string,
    sessionId: string,
    place: HarnessPlace,
    cwd: string,
    choice: HarnessModelChoice | undefined,
  ) {
    const gone: AlignAnswer = { _tag: 'Gone' };
    let uncarried: string | null = null;
    for (;;) {
      const decided = yield* store.change(threadId, (facet, unit) => decide(threadId, sessionId, facet, unit, choice, uncarried), aligning);
      if (decided._tag === 'Gone' || decided._tag === 'Again') return gone;
      if (decided._tag === 'Aligned') return yield* noted(threadId, decided.facet, decided.reason);
      if (decided._tag === 'Carry') {
        const carried = yield* carrying(decided);
        if (carried._tag === 'Refused') uncarried = carried.reason;
        else yield* store.change(threadId, (facet, unit) => moved(unit, threadId, facet, decided), aligning);
        continue;
      }
      const { terminals, writing, records, discharge, access } = preparing;
      const answer = yield* cutRoot(terminals, writing, records, discharge, access, decided.adapter, decided.making, place, {
        sessionId,
        cwd,
        ask: decided.ask,
      });
      if (answer._tag === 'Aborted') return gone;
      if (answer._tag === 'Uncertain') {
        const uncertain: AlignAnswer = { _tag: 'Uncertain', reason: `The vendor session cut did not complete: ${answer.reason}.` };
        return uncertain;
      }
      const committed = yield* store.change(
        threadId,
        (standing, unit) => commit(threadId, sessionId, standing, unit, choice, decided, answer),
        aligning,
      );
      if (committed._tag === 'Again') continue;
      return committed._tag === 'Aligned' ? yield* noted(threadId, committed.facet, committed.reason) : gone;
    }
  });

  const holds = Effect.fnUntraced(function* (threadId: string, facet: ExternalSession, cut: LaunchedCut, unit?: Unit<'machine'>) {
    const { alignment } = yield* judged(threadId, facet, accountKey(facet.session?.account), cut.own ? cut.root : null, unit);
    return sameCut(alignment, cut);
  });

  const due = Effect.fnUntraced(function* (threadId: string) {
    const facet = yield* store.read(threadId);
    const session = facet?.session;
    const adapter = facet === null ? null : adapters.running(facet);
    if (facet === null || adapter === null || session === undefined || facet.plain === true) return false;
    if (session.cut !== undefined) return !(yield* holds(threadId, facet, session.cut));
    const standing = facet.observation.binding.rootKey ?? harnessRoot(adapter, session.argv);
    if (facet.sessionKey === null)
      return facet.observation.binding.rootKey !== null || (standing !== null && (yield* turns.session(threadId)) === null);
    if (standing !== null && standing !== facet.sessionKey) return true;
    return stale((yield* judged(threadId, facet, accountKey(session.account), facet.sessionKey)).alignment);
  });

  const bound = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, threadId: string, facet: ExternalSession) {
    const session = facet.session;
    const cut = session?.cut;
    if (session === undefined || cut === undefined || facet.observation.binding.rootKey !== cut.into) return facet;
    const { cut: _settled, ...rest } = session;
    if (!(yield* holds(threadId, facet, cut, unit))) {
      const kept: ExternalSession = { ...facet, sessionKey: cut.own ? cut.root : null, session: rest };
      return kept;
    }
    yield* turns.committed(unit, threadId, cut, accountKey(session.account));
    const committed: ExternalSession = { ...facet, sessionKey: cut.into, session: rest };
    return committed;
  });

  return {
    writes: aligning,
    align,
    due,
    taken: (unit, threadId, run, address) => turns.record(unit, threadId, [{ run, address }]),
    bound,
  };
};

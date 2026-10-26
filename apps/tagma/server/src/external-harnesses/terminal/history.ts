import { Effect } from 'effect';
import type { ThreadForkCut } from '@runlith/agent/thread/record';
import { bordered } from '@runlith/agent/thread/ThreadBorder';
import type { JournalRuns, TransportHistory } from '@runlith/agent/thread/transport/contract';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessSeat } from '../../threads/contract/wire/harness/seat.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { terminalKernel } from '../birth/seat.js';
import type { SessionDriver } from '../sessions/drive.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { accountKey, type VendorTurns } from '../store/turns.js';

const refused = (reason: string) => new GateRefusal('harness-contract', reason, ['read the thread; its conversation stands as it was']);

const going = (threadId: string) =>
  new GateRefusal('thread-running', `A turn of ${threadId} is going; its conversation is restored between turns.`, [
    'stop the turn, then restore again',
  ]);

const rooted = (facet: ExternalSession, root: string | null): ExternalSession => ({ ...facet, sessionKey: root });

export type TerminalHistory = {
  readonly transport: TransportHistory;
  readonly seat: (source: string, unit: WriteUnit<'machine'>) => Effect.Effect<HarnessSeat, HarnessFailure>;
};

export const makeTerminalHistory = (
  store: HarnessSessionStore,
  turns: VendorTurns,
  journal: JournalRuns,
  sessions: SessionDriver,
): TerminalHistory => {
  const seat = Effect.fnUntraced(function* (source: string, unit: WriteUnit<'machine'>) {
    const facet = yield* store.readIn(source, unit);
    if (facet === null) return yield* refused('The source conversation has no session to fork.');
    const plain = facet.plain === true;
    const seated: HarnessSeat = {
      facet: {
        ...harnessFacet(facet.name),
        ...(facet.home === undefined ? {} : { home: facet.home }),
        ...(facet.plain === undefined ? {} : { plain: facet.plain }),
        ...(facet.permissionMode === undefined ? {} : { permissionMode: facet.permissionMode }),
      },
      kernel: terminalKernel(facet.name, yield* store.asked(source, unit), plain, {}),
    };
    return seated;
  });

  const restore = Effect.fnUntraced(function* (threadId: string, runIds: readonly string[]) {
    if ((yield* store.read(threadId)) === null) return;
    yield* store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          if (facet.turn !== undefined) return yield* going(threadId);
          if (yield* turns.holds(unit, threadId, runIds)) return { facet, value: undefined };
          const returned = yield* turns.returned(unit, threadId, runIds);
          if (returned !== null) return { facet: rooted(facet, returned.root), value: undefined };
          yield* turns.forget(unit, threadId);
          return { facet: rooted(facet, null), value: undefined };
        }),
      turns.writes,
    );
  });

  const reset = Effect.fnUntraced(function* (threadId: string) {
    if ((yield* store.read(threadId)) === null) return;
    yield* store.change(
      threadId,
      (facet, unit) =>
        facet.turn !== undefined
          ? going(threadId)
          : Effect.as(turns.forget(unit, threadId), { facet: rooted(facet, null), value: undefined }),
      turns.writes,
    );
  });

  const fork = Effect.fnUntraced(function* (source: string, child: string, cut: ThreadForkCut, unit: WriteUnit<'machine'>) {
    const facet = yield* store.readIn(source, unit);
    if (facet === null) return yield* refused('The source conversation has no session to fork.');
    const root = facet.sessionKey;
    if (cut.kind === 'none' || root === null) return;
    const account = accountKey(facet.session?.account);
    if ((yield* turns.session(source, unit)) === null) {
      if (cut.kind !== 'all' || (yield* Effect.mapError(journal.rewound(source, unit), threadCallFailed)).length > 0) return;
      yield* turns.forked(unit, child, { root, address: null }, account);
      return;
    }
    const before = cut.kind === 'before' ? yield* turns.turn(source, cut.runId, unit) : undefined;
    if (cut.kind === 'before' && (before === undefined || before.address === null)) return;
    const taken = yield* Effect.mapError(journal.cut(source, unit), threadCallFailed);
    const point = yield* turns.point(source, taken, before?.ordinal ?? null, unit);
    if (point._tag === 'Fresh') return;
    const at =
      point._tag === 'Cut'
        ? { address: point.address, ordinal: point.ordinal }
        : { address: before?.address ?? null, ordinal: before?.ordinal ?? null };
    yield* turns.copy(unit, source, child, at.ordinal);
    yield* turns.forked(unit, child, { root, address: at.address }, account);
  });

  return {
    transport: {
      restore: (threadId, runIds) => bordered(restore(threadId, runIds)),
      reset: (threadId) => bordered(reset(threadId)),
      fork: (source, child, cut, _account, tx) => bordered(fork(source, child, cut, tx as unknown as WriteUnit<'machine'>)),
      moved: (threadId) => bordered(sessions.aligned(threadId)),
    },
    seat,
  };
};

import { Effect } from 'effect';
import type { ThreadForkCut } from '@runlith/agent/thread/record';
import { bordered } from '@runlith/agent/thread/ThreadBorder';
import type { JournalRuns, LaunchGuidance, TransportHistory } from '@runlith/agent/thread/transport/contract';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import type { HarnessSeat } from '../../threads/contract/wire/harness/seat.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { acpKernel } from '../birth/seat.js';
import { harnessAdapter, harnessPresentation } from '../contract/service/table.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { VendorTurns } from '../store/turns.js';
import type { ProtocolAttendance } from './attendance.js';
import type { ProtocolReactor } from './reactor.js';
import { freshRow } from './row.js';

const refused = (reason: string) => new GateRefusal('harness-contract', reason, ['read the thread; its conversation stands as it was']);

const going = (threadId: string) =>
  new GateRefusal('thread-running', `A turn of ${threadId} is going; its conversation is restored between turns.`, [
    'stop the turn, then restore again',
  ]);

export class ProtocolHistory {
  constructor(
    private readonly reactor: ProtocolReactor,
    private readonly attendance: ProtocolAttendance,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly turns: VendorTurns,
    private readonly guidance: LaunchGuidance,
    private readonly journal: JournalRuns,
  ) {}

  readonly transport: TransportHistory = {
    restore: (threadId, runIds) => bordered(this.restore(threadId, runIds)),
    reset: (threadId) => bordered(this.reset(threadId)),
    fork: (source, child, cut, account, tx) => bordered(this.fork(source, child, cut, account, tx as unknown as WriteUnit<'machine'>)),
    moved: () => Effect.void,
  };

  readonly seat = Effect.fnUntraced(function* (this: ProtocolHistory, source: string, unit: WriteUnit<'machine'>) {
    const { store } = this;
    const facet = yield* store.readIn(source, unit);
    if (facet === null) return yield* refused('The source conversation has no session to fork.');
    const binding = yield* store.binding(source, unit);
    const seat: HarnessSeat = {
      facet: harnessFacet(facet.name, harnessPresentation(facet.name)),
      kernel: acpKernel(facet.name, binding?.agent ?? null, yield* store.asked(source, unit), {}),
    };
    return seat;
  });

  readonly fork = Effect.fnUntraced(function* (
    this: ProtocolHistory,
    source: string,
    child: string,
    cut: ThreadForkCut,
    account: string | null,
    unit: WriteUnit<'machine'>,
  ) {
    const { store, rows, turns, journal } = this;
    const facet = yield* store.readIn(source, unit);
    const profile = facet === null ? undefined : harnessAdapter(facet.name).acp;
    if (facet === null || profile?.proves.fork !== true) return yield* refused('This harness does not fork its conversation.');
    const reachable = facet.session?.account === undefined || facet.session.account.key === account;
    const before = cut.kind === 'before' ? yield* turns.turn(source, cut.runId, unit) : undefined;
    const whole = reachable && facet.sessionKey !== null && (cut.kind === 'all' || (cut.kind === 'before' && before?.address != null));
    const taken = whole ? yield* Effect.mapError(journal.cut(source, unit), threadCallFailed) : [];
    const point = whole ? yield* turns.point(source, taken, before?.ordinal ?? null, unit) : null;
    const at =
      point === null || point._tag === 'Fresh'
        ? null
        : point._tag === 'Cut'
          ? { address: point.address, ordinal: point.ordinal }
          : { address: before?.address ?? null, ordinal: before?.ordinal ?? null };
    yield* rows.write(unit, child, {
      ...freshRow(child, null, null),
      fork: at === null || facet.sessionKey === null ? null : { session: facet.sessionKey, prompt: at.address },
    });
    if (at === null) return;
    yield* turns.copy(unit, source, child, at.ordinal);
    const owed = cut.kind === 'all' ? yield* turns.owed(source, unit) : null;
    if (owed !== null) yield* turns.owe(unit, child, owed);
  });

  readonly restore = Effect.fnUntraced(function* (this: ProtocolHistory, threadId: string, runIds: readonly string[]) {
    const { rows, turns } = this;
    if ((yield* rows.load(threadId)) === null) return;
    const kept = { held: true };
    yield* this.reactor.change(threadId, (facet, unit, row) =>
      Effect.map(turns.holds(unit, threadId, runIds), (held) => {
        kept.held = held && (row.cut === null || row.cut.request === null);
        return { facet, row };
      }),
    );
    if (kept.held) return;
    if (!(yield* this.returned(threadId, runIds))) yield* this.reset(threadId);
  });

  private readonly returned = Effect.fnUntraced(function* (this: ProtocolHistory, threadId: string, runIds: readonly string[]) {
    const { rows, turns, attendance, guidance } = this;
    const replaced = (yield* turns.session(threadId))?.replaced ?? null;
    const asked = new Set(runIds);
    if (replaced === null || replaced.cut.length !== asked.size || replaced.cut.some((run) => !asked.has(run))) return false;
    const row = yield* rows.load(threadId);
    if (row === null) return false;
    if (row.turns.length > 0) return yield* going(threadId);
    yield* attendance.stop(threadId);
    const back = { root: null as string | null };
    yield* this.reactor.change(threadId, (facet, unit, standing) =>
      Effect.flatMap(turns.returned(unit, threadId, runIds), (returned) =>
        returned === null
          ? Effect.succeed({ facet, row: standing })
          : Effect.sync(() => {
              back.root = returned.root;
              guidance.reset(threadId, false);
              return {
                facet: {
                  ...facet,
                  sessionKey: returned.root,
                  observation: { ...facet.observation, binding: { ...facet.observation.binding, rootKey: returned.root } },
                },
                row: { ...standing, cut: null },
              };
            }),
      ),
    );
    return back.root !== null;
  });

  readonly reset = Effect.fnUntraced(function* (this: ProtocolHistory, threadId: string) {
    const { store, rows, turns, attendance, guidance } = this;
    const facet = yield* store.read(threadId);
    if (facet === null || harnessAdapter(facet.name).acp?.proves.rewind !== true)
      return yield* refused('This harness does not restore its conversation.');
    const row = yield* rows.load(threadId);
    if (row === null) return;
    if (row.turns.length > 0) return yield* going(threadId);
    yield* attendance.stop(threadId);
    yield* this.reactor.change(threadId, (facet, unit, row) =>
      Effect.as(
        Effect.andThen(
          turns.forget(unit, threadId),
          Effect.sync(() => guidance.reset(threadId, false)),
        ),
        {
          facet: {
            ...facet,
            sessionKey: null,
            observation: { ...facet.observation, binding: { ...facet.observation.binding, rootKey: null } },
          },
          row,
        },
      ),
    );
  });
}

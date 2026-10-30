import { Clock, Effect } from 'effect';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessProcessOutcome, HarnessSession } from '../../threads/contract/wire/harness/session.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { RunActivities } from './activities.js';
import type { ProtocolLaunches } from './launches.js';
import { halt } from './halts.js';
import { facetOf, type Linked } from './links.js';
import type { ProtocolReactor } from './reactor.js';
import { freshRow, type ProtocolRow } from './row.js';
import type { ProtocolSteps } from './steps.js';
import type { LaunchRefusal } from './turns.js';

export type SessionEnded = (
  threadId: string,
  session: HarnessSession,
  announce: boolean,
  runs: readonly string[],
) => Effect.Effect<void, HarnessFailure>;

export const unfinished = (row: ProtocolRow): boolean =>
  row.client.requests.length > 0 || row.client.asks.length > 0 || row.turns.length > 0;

export class ProtocolEndings {
  constructor(
    private readonly steps: ProtocolSteps,
    private readonly reactor: ProtocolReactor,
    private readonly activities: RunActivities,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly inbox: ThreadInbox['Service'],
    private readonly terminals: Terminals['Service'],
    private readonly ended: SessionEnded,
    private readonly launches: ProtocolLaunches,
    private readonly runs: NativeStorage['Service']['runs'],
    private readonly linked: (facet: ExternalSession) => Effect.Effect<Linked, HarnessFailure>,
    private readonly ownerId: string,
  ) {}

  readonly finish = Effect.fnUntraced(function* (
    this: ProtocolEndings,
    threadId: string,
    sessionId: string,
    outcome: HarnessProcessOutcome,
    failure: string | null,
    refusal: LaunchRefusal = 'passing',
  ) {
    const { rows, store, steps, inbox } = this;
    const standing = yield* rows.load(threadId);
    if (standing !== null && unfinished(standing))
      yield* this.retired(threadId, yield* facetOf(store, threadId), sessionId, standing, failure ?? 'the agent process ended');
    yield* steps.lapse(threadId);
    const stored = yield* rows.load(threadId);
    const written = yield* store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const session = facet.session;
          if (!session || session.id !== sessionId || session.state === 'ended') return { facet, value: null };
          for (const request of stored?.client.requests ?? []) {
            if (request.meaning === 'prompt' && !request.admitted && !request.uncertain)
              yield* inbox.returnInput(threadId, request.envelopes, request.turn, unit);
          }
          if (stored !== null) yield* rows.write(unit, threadId, freshRow(sessionId, stored, null));
          const ended: ExternalSession = { ...facet, execution: null, session: { ...session, state: 'ended', ownerId: null } };
          return { facet: ended, value: ended.session ?? null };
        }),
      rows.writes,
    );
    if (written !== null) yield* this.report(threadId, written, [sessionId]);
    if (outcome !== 'completed') yield* this.unlaunched(threadId, failure ?? 'the agent process ended', refusal);
  });

  private readonly unlaunched = Effect.fnUntraced(function* (
    this: ProtocolEndings,
    threadId: string,
    failure: string,
    refusal: LaunchRefusal,
  ) {
    const { launches, store, steps } = this;
    const owed = launches.owing(threadId);
    const compacting = launches.compactionOwed(threadId);
    const run = owed?.run ?? compacting?.run;
    if (run === undefined) return;
    launches.finish(run.id);
    const facet = yield* facetOf(store, threadId);
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* steps.close(
      threadId,
      facet.name,
      {
        turn: run.id,
        at,
        status: 'failed',
        failure,
        stoppedBy: null,
        launch: refusal,
      },
      owed === undefined || owed.seed.length === 0 ? [] : [{ fate: 'returned', turn: run.id, items: owed.seed.map((item) => item.id) }],
    );
  });

  readonly unreadable = Effect.fnUntraced(function* (this: ProtocolEndings, threadId: string, sessionId: string, failure: GateRefusal) {
    const { store, ownerId, terminals, runs, steps } = this;
    const facet = yield* facetOf(store, threadId);
    if (facet.session?.id !== sessionId || facet.session.ownerId !== ownerId) return;
    yield* halt(terminals, threadId, facet);
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const said = `${failure.code}: ${failure.reason}`;
    const turn = (yield* runs(ownerId).runningOf([threadId])).at(-1)?.id ?? null;
    const ended = yield* store.owned(threadId, sessionId, ownerId, (current, session) => ({
      ...current,
      execution: null,
      session: { ...session, state: 'ended', ownerId: null },
    }));
    if (ended !== null && turn !== null && turn !== undefined) {
      yield* steps.close(threadId, facet.name, { turn, at, status: 'failed', failure: said, stoppedBy: null });
    }
    if (ended !== null) yield* steps.lapse(threadId);
    if (ended?.session !== undefined) yield* this.report(threadId, ended.session, [sessionId]);
  });

  report(threadId: string, session: HarnessSession, runs: readonly string[]): Effect.Effect<void, HarnessFailure> {
    return this.ended(threadId, session, true, runs);
  }

  readonly retired = Effect.fnUntraced(function* (
    this: ProtocolEndings,
    threadId: string,
    facet: ExternalSession,
    sessionId: string,
    stored: ProtocolRow,
    detail = 'the agent process was replaced',
  ) {
    const { steps, reactor } = this;
    const old = yield* steps.link(facet, sessionId, yield* this.linked(facet), threadId, stored);
    old.poisoned = detail;
    old.halted = true;
    yield* reactor.locked(
      old,
      Effect.gen(function* () {
        if (facet.session?.state === 'stopping' && facet.sessionKey !== null)
          yield* steps.intend(old, { _tag: 'Cancel', params: { sessionId: facet.sessionKey } });
        return yield* steps.observe(old, { _tag: 'Exited', detail });
      }),
    );
  });
}

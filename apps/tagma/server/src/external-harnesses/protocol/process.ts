import { Clock, Effect, Stream } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { waitsForTurn } from '@runlith/agent/thread/inboxItems';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessSession } from '../../threads/contract/wire/harness/session.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { TerminalEndings } from '../../executions/contract/service/endings.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { HarnessLanes } from '../sessions/lanes.js';
import { exitLine, LOST_LINE } from '../sessions/lifecycle.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { unfinished, type ProtocolEndings } from './endings.js';
import { halt, type ProtocolHalts } from './halts.js';
import { due, idling, resting, restingRow, touch } from './idle.js';
import type { ProtocolLauncher } from './launcher.js';
import type { ProtocolLaunches } from './launches.js';
import { reading, stderrTail, type Ending } from './link.js';
import { facetOf, type Link, type ProtocolLinks } from './links.js';
import type { AcpProfile } from './profile.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { ProtocolAsides } from './asides.js';
import type { ProtocolReactor } from './reactor.js';
import { freshRow, prompting, type ProtocolRow } from './row.js';
import type { ProtocolSteps } from './steps.js';

const RESUBSCRIBE_MS = 250;

const NANOS_PER_MS = 1_000_000n;

export class ProtocolProcess {
  private readonly stopping = new Set<string>();
  private readonly released = new Set<string>();

  constructor(
    private readonly links: ProtocolLinks,
    private readonly steps: ProtocolSteps,
    private readonly reactor: ProtocolReactor,
    private readonly asides: ProtocolAsides,
    private readonly halts: ProtocolHalts,
    private readonly launcher: ProtocolLauncher,
    private readonly endings: ProtocolEndings,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly records: ExecutionRecords['Service'],
    private readonly terminals: Terminals['Service'],
    private readonly executionEndings: TerminalEndings['Service'],
    private readonly lanes: HarnessLanes,
    private readonly inbox: ThreadInbox['Service'],
    private readonly runs: NativeStorage['Service']['runs'],
    private readonly launches: ProtocolLaunches,
    private readonly profile: (name: HarnessName) => AcpProfile,
    private readonly idleMs: number,
    private readonly ownerId: string,
    private readonly build: string,
  ) {}

  stale(row: ProtocolRow, name: HarnessName): boolean {
    return this.profile(name).hosts !== null && row.build !== this.build;
  }

  readonly drive = Effect.fnUntraced(function* (this: ProtocolProcess, threadId: string, linked: () => void = () => {}) {
    const { store, rows, endings, launcher, terminals, links, steps, lanes, reactor, executionEndings, records, released } = this;
    released.delete(threadId);
    while (true) {
      const facet = yield* facetOf(store, threadId);
      const session = facet.session;
      if (session === undefined || session.state === 'ended') return;
      const stored = yield* rows.load(threadId);
      if (session.state === 'stopping' && facet.execution === null) return yield* endings.finish(threadId, session.id, 'aborted', null);
      const launch = facet.execution === null ? yield* launcher.launch(threadId, facet, session, stored) : null;
      const execution = facet.execution ?? launch?.execution ?? null;
      if (execution === null) return;
      const launched = launch?.fresh === true;
      const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(Effect.mapError(threadCallFailed));
      if (record === null) return yield* endings.finish(threadId, session.id, 'failed', LOST_LINE);
      const lost = (yield* terminals.lost(record)) !== null;
      const same = stored?.execution?.execution === execution.execution && stored.execution.incarnation === execution.incarnation;
      if (!same && stored !== null && unfinished(stored)) yield* endings.retired(threadId, facet, session.id, stored);
      const carried = same ? null : yield* rows.load(threadId);
      const row = same
        ? stored!
        : {
            ...freshRow(`${session.id}.${carried?.launches ?? 0}.${execution.incarnation}`, carried, execution),
            build: launched ? this.build : undefined,
          };
      const link = yield* steps.link(facet, session.id, this.profile(facet.name), threadId, row);
      link.stale = this.stale(row, facet.name);
      links.set(link);
      linked();
      yield* touch(link);
      if (!lost) yield* lanes.open(session.id, record.projectId, record.execution, record.holder);
      if (same) {
        const recalled = yield* this.recalled(link.row);
        yield* reactor.locked(link, steps.observe(link, { _tag: 'Recovered' }));
        const key = link.facet.sessionKey;
        if (recalled && key !== null && !lost)
          link.writer.cancel(
            { sessionId: key },
            link.row.turns.map((turn) => turn.id),
            null,
          );
      } else yield* reactor.locked(link, steps.persist(link, {}));
      if (!lost) yield* this.attended(link, record.execution);
      yield* reactor.locked(link, Effect.succeed(null));
      for (const landing of link.writer.unsettled()) yield* reactor.locked(link, steps.landed(link, landing));
      const decided = yield* executionEndings.decided({ projectId: record.projectId, execution: record.execution });
      const exit =
        decided._tag === 'Unwatchable'
          ? LOST_LINE
          : decided.summary.state.nativeExit === undefined
            ? 'no exit receipt'
            : exitLine(decided.summary.state.nativeExit);
      const said = decided._tag === 'Unwatchable' ? '' : yield* stderrTail(records, record.execution);
      const detail = said === '' ? exit : `${exit}; stderr: ${said}`;
      yield* reactor.locked(link, steps.observe(link, { _tag: 'Exited', detail }));
      links.drop(threadId);
      yield* this.asides.exited(threadId);
      const after = yield* facetOf(store, threadId);
      const stopped = after.session?.state === 'stopping' || after.retiring === true;
      const fate = this.fateOf(link);
      if (!stopped && fate?._tag === 'Restart' && (yield* this.relaunched(link, session, 'running'))) continue;
      const idled = released.delete(threadId);
      if (idled && after.retiring !== true && (yield* this.unread(threadId)) && (yield* this.relaunched(link, session, 'stopping')))
        continue;
      const failure = stopped ? null : fate?._tag === 'Failed' ? fate.reason : `The agent process ended: ${detail}`;
      return yield* endings.finish(threadId, session.id, idled ? 'completed' : stopped ? 'aborted' : 'failed', failure);
    }
  });

  private readonly attended = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link, execution: ExecutionRef) {
    const { reactor, steps, idleMs } = this;
    link.facet = yield* this.reconciled(link);
    yield* reactor.held(link);
    if (link.row.phase === 'handshake' && !link.row.client.requests.some((request) => request.meaning === 'initialize')) {
      yield* reactor.locked(
        link,
        steps.intend(link, {
          _tag: 'Initialize',
          capabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          info: { name: 'tagma', version: '1' },
        }),
      );
    } else {
      yield* reactor.pump(link);
    }
    const handshaking = this.handshaking(link);
    const winding = this.ending(link);
    const releasing = this.release(link, this.idled(link));
    const retiring = this.retire(link);
    const unconfirmed = this.unconfirmed(link);
    const output = this.read(link, execution);
    yield* Effect.scoped(
      Effect.gen(function* () {
        if (link.row.phase !== 'ready') yield* Effect.forkScoped(handshaking);
        if (link.facet.session?.state === 'stopping') yield* Effect.forkScoped(winding);
        if (link.stale) yield* Effect.forkScoped(retiring);
        yield* Effect.forkScoped(idling(link, releasing, idleMs));
        yield* Effect.forkScoped(unconfirmed);
        yield* Effect.raceFirst(
          output,
          Effect.raceFirst(link.writer.drive(reactor.locked(link, Effect.succeed(null))), reactor.prepared(link)),
        );
      }),
    );
  });

  forsaken(threadId: string): Effect.Effect<void> {
    const link = this.links.get(threadId);
    return link === undefined ? Effect.void : this.steps.forsaken(link);
  }

  readonly quiet = Effect.fnUntraced(function* (this: ProtocolProcess, threadId: string) {
    const { store, rows, terminals, executionEndings, records } = this;
    const execution = (yield* facetOf(store, threadId)).execution;
    const row = yield* rows.load(threadId);
    if (execution === null || row === null) return 'exited' as const;
    const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(Effect.mapError(threadCallFailed));
    if (record === null || (yield* terminals.lost(record)) !== null) return 'exited' as const;
    const ending: Ending = { reason: null, retainedFrom: 0n };
    return yield* Effect.raceFirst(
      Effect.as(executionEndings.decided({ projectId: record.projectId, execution: record.execution }), 'exited' as const),
      Effect.as(
        Stream.runHead(reading(records, record.execution, row.client.cursor, ending)).pipe(Effect.mapError(threadCallFailed)),
        'output' as const,
      ),
    );
  });

  readonly exited = Effect.fnUntraced(function* (this: ProtocolProcess, threadId: string) {
    const { store, terminals, executionEndings } = this;
    const execution = (yield* facetOf(store, threadId)).execution;
    if (execution === null) return;
    const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(Effect.mapError(threadCallFailed));
    if (record === null) return;
    yield* executionEndings.decided({ projectId: record.projectId, execution: record.execution });
  });

  readonly ending = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    const { stopping } = this;
    if (stopping.has(link.threadId)) return;
    stopping.add(link.threadId);
    yield* this.winding(link).pipe(Effect.ensuring(Effect.sync(() => stopping.delete(link.threadId))));
  });

  private readonly winding = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    const { store, reactor, steps, terminals } = this;
    const until = link.row.client.stopping ?? (yield* Clock.currentTimeMillis) + link.profile.graceMs;
    const key = link.facet.sessionKey;
    yield* reactor.locked(
      link,
      Effect.gen(function* () {
        link.facet = yield* facetOf(store, link.threadId);
        if (!prompting(link.row) || link.row.client.stopping !== null || key === null) return null;
        return yield* steps.intend(link, { _tag: 'Stop', params: { sessionId: key }, until });
      }),
    );
    yield* this.settles(link, (row) => !prompting(row), until);
    if (link.row.agent?.close === true && key !== null) {
      yield* reactor.locked(link, steps.intend(link, { _tag: 'Close', params: { sessionId: key } }));
      yield* this.settles(link, (row) => !row.client.requests.some((request) => request.meaning === 'close'), until);
    }
    yield* halt(terminals, link.threadId, yield* facetOf(store, link.threadId));
  });

  readonly idle = Effect.fnUntraced(function* (this: ProtocolProcess, threadId: string) {
    const { store, rows, released } = this;
    const row = yield* rows.load(threadId);
    const facet = yield* facetOf(store, threadId);
    if (row === null || !restingRow(row, facet) || (yield* this.unread(threadId))) return false;
    const stopped = yield* store.change(threadId, (current) => {
      const session = current.session;
      if (session?.state !== 'running') return Effect.succeed({ facet: current, value: false });
      return Effect.succeed({ facet: { ...current, session: { ...session, state: 'stopping' as const } }, value: true });
    });
    if (stopped) released.add(threadId);
    return stopped;
  });

  private readonly release = Effect.fnUntraced(function* <E>(this: ProtocolProcess, link: Link, marking: Effect.Effect<boolean, E>) {
    const marked = yield* this.links.locked(link, marking);
    if (!marked) return false;
    this.released.add(link.threadId);
    yield* this.ending(link);
    return true;
  });

  private readonly retire = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    const { links } = this;
    let refused = false;
    const marking = Effect.suspend(() =>
      resting(link) ? Effect.tap(this.mark(link), (stopped) => Effect.sync(() => (refused = !stopped))) : Effect.succeed(false),
    );
    while (!refused) {
      const rested = yield* links
        .until(link.threadId, (current) => (current !== link ? false : resting(link) ? true : null))
        .pipe(Effect.catchTag('LinkEnded', () => Effect.succeed(false)));
      if (!rested) return;
      if (yield* this.release(link, marking)) {
        return yield* Effect.logInfo('an agent process of another Tagma build was replaced at rest', {
          threadId: link.threadId,
          build: link.row.build ?? null,
        });
      }
    }
  });

  private readonly idled = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    if (!(yield* due(link, this.idleMs)) || !resting(link) || (yield* this.unread(link.threadId))) return false;
    return yield* this.mark(link);
  });

  private readonly mark = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    const { store } = this;
    const stopped = yield* store.change(link.threadId, (facet) => {
      const session = facet.session;
      if (session?.id !== link.sessionId || session.state !== 'running') return Effect.succeed({ facet, value: false });
      return Effect.succeed({ facet: { ...facet, session: { ...session, state: 'stopping' as const } }, value: true });
    });
    if (stopped) link.facet = yield* facetOf(store, link.threadId);
    return stopped;
  });

  private unread(threadId: string) {
    return Effect.map(
      this.inbox.launchItems(threadId),
      (launch) =>
        this.launches.owing(threadId) !== undefined ||
        this.launches.compactionOwed(threadId) !== undefined ||
        [...launch.waiting, ...launch.readable].some((item) => !waitsForTurn(item)) ||
        launch.compactions.length > 0,
    );
  }

  private relaunched(link: Link, session: HarnessSession, mid: 'stopping' | 'running') {
    const { store, ownerId, rows } = this;
    return store.change(
      link.threadId,
      (current, unit) =>
        Effect.gen(function* () {
          const held = current.session;
          if (held?.id !== session.id || held.ownerId !== ownerId || (mid === 'running' && held.state === 'stopping'))
            return { facet: current, value: false };
          yield* rows.write(unit, link.threadId, { ...link.row, launches: link.row.launches + 1 });
          return { facet: { ...current, execution: null, session: { ...held, state: 'starting' as const } }, value: true };
        }),
      rows.writes,
    );
  }

  private readonly settles = Effect.fnUntraced(function* (
    this: ProtocolProcess,
    link: Link,
    done: (row: ProtocolRow) => boolean,
    until: number,
  ) {
    const left = until - (yield* Clock.currentTimeMillis);
    if (left <= 0) return;
    yield* this.links
      .until(link.threadId, (current) => (current !== link || done(link.row) ? true : null), { within: left })
      .pipe(Effect.catchTags({ LinkEnded: () => Effect.void, WaitExpired: () => Effect.void }), Effect.asVoid);
  });

  private fateOf(link: Link): { readonly _tag: 'Restart' } | { readonly _tag: 'Failed'; readonly reason: string } | null {
    if (link.row.failure !== null) return { _tag: 'Failed', reason: link.row.failure };
    if (link.refusal !== null) return { _tag: 'Failed', reason: `${link.refusal.code}: ${link.refusal.reason}` };
    if (link.refused === null) return null;
    return { _tag: 'Restart' };
  }

  private readonly recalled = Effect.fnUntraced(function* (this: ProtocolProcess, row: ProtocolRow) {
    if (!prompting(row)) return false;
    if (row.client.requests.some((request) => request.meaning === 'prompt' && request.cancelled)) return true;
    const store = this.runs(this.ownerId);
    for (const turn of row.turns) if ((yield* store.runById(turn.id))?.status !== 'running') return true;
    return false;
  });

  private readonly reconciled = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    const { store, ownerId } = this;
    const facet: ExternalSession = yield* facetOf(store, link.threadId);
    if (facet.session?.state !== 'uncertain' && facet.session?.state !== 'starting') return facet;
    const back = yield* store.owned(link.threadId, link.sessionId, ownerId, (current, held) => ({
      ...current,
      session: { ...held, state: 'running' },
    }));
    return back ?? facet;
  });

  private readonly handshaking = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    yield* Effect.sleep(link.profile.handshakeMs);
    if (link.row.phase === 'ready') return;
    yield* this.halts.failed(
      link,
      new GateRefusal('session-failed', `The agent did not open its session within ${link.profile.handshakeMs / 1000} s.`, [
        'read the agent diagnostics, then start the thread again',
      ]),
    );
  });

  private readonly unconfirmed = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link) {
    const { links, reactor, steps } = this;
    const grace = BigInt(link.profile.graceMs) * NANOS_PER_MS;
    const marks = new Map<string, bigint>();
    const uncertain = (row: ProtocolRow): readonly string[] =>
      row.client.requests
        .filter((request) => request.meaning === 'prompt' && request.uncertain && !request.admitted)
        .map((request) => request.id);
    const expired = (now: bigint) => uncertain(link.row).some((id) => now - (marks.get(id) ?? now) >= grace);
    const failed = (row: ProtocolRow): ProtocolRow => ({
      ...row,
      failure: 'The agent did not confirm its uncertain prompt; the process is closed without replaying these words.',
    });
    const clock = yield* Clock.Clock;
    while (link.row.failure === null) {
      const now = clock.monotonicTimeNanosUnsafe();
      const standing = uncertain(link.row);
      for (const id of marks.keys()) if (!standing.includes(id)) marks.delete(id);
      for (const id of standing) if (!marks.has(id)) marks.set(id, now);
      if (expired(now)) {
        const written = yield* Effect.result(
          reactor.locked(
            link,
            Effect.suspend(() =>
              links.get(link.threadId) === link && expired(clock.monotonicTimeNanosUnsafe())
                ? steps.persist(link, { row: failed })
                : Effect.succeed(null),
            ),
          ),
        );
        if (written._tag === 'Success') continue;
        yield* Effect.logWarning('an expired uncertain prompt could not be recorded; the next heartbeat tries again', {
          threadId: link.threadId,
          failure: written.failure,
        });
        yield* Effect.sleep(LEASE_RHYTHM.heartbeatIntervalMs);
        continue;
      }
      const left = [...marks.values()].reduce<bigint | null>((soonest, at) => {
        const due = at + grace - now;
        return soonest === null || due < soonest ? due : soonest;
      }, null);
      const seen = standing.join('|');
      const moved = yield* links
        .until(
          link.threadId,
          (current) => (current !== link || link.row.failure !== null || uncertain(link.row).join('|') !== seen ? true : null),
          left === null ? {} : { within: Math.max(1, Math.ceil(Number(left / NANOS_PER_MS))) },
        )
        .pipe(Effect.catchTags({ LinkEnded: () => Effect.succeed(false), WaitExpired: () => Effect.succeed(true) }));
      if (!moved || links.get(link.threadId) !== link) return;
    }
  });

  private readonly read = Effect.fnUntraced(function* (this: ProtocolProcess, link: Link, execution: ExecutionRef) {
    const { records, reactor, steps } = this;
    while (true) {
      const ending: Ending = { reason: null, retainedFrom: 0n };
      yield* Stream.runForEachArray(reading(records, execution, link.row.client.cursor, ending), (reads) =>
        Effect.gen(function* () {
          yield* touch(link);
          const inbound = reads.flatMap((read) => (read._tag === 'Frame' ? [read.inbound] : []));
          for (let at = 0; at < inbound.length;) {
            yield* reactor.locked(
              link,
              Effect.map(steps.received(link, inbound, at), (received) => {
                at += received.taken;
                return received.persisted;
              }),
            );
          }
          const over = reads.find((read) => read._tag === 'Oversized');
          if (over !== undefined) {
            yield* reactor.locked(
              link,
              Effect.suspend(() =>
                steps.observe(link, {
                  _tag: 'Oversized',
                  start: over.start,
                  ceiling: over.ceiling,
                  session: link.facet.sessionKey === null ? null : { sessionId: link.facet.sessionKey },
                }),
              ),
            );
          }
        }),
      ).pipe(Effect.mapError(threadCallFailed));
      if (ending.reason === 'completed') return yield* halt(this.terminals, link.threadId, yield* facetOf(this.store, link.threadId));
      if (ending.reason === 'lost') {
        yield* reactor.locked(
          link,
          steps.persist(link, {
            row: (row) => ({ ...row, failure: 'The host ended the agent output subscription without a completed output record.' }),
          }),
        );
        return;
      }
      if (ending.reason === 'gap') {
        const resume = ending.retainedFrom;
        yield* reactor.locked(
          link,
          Effect.suspend(() => steps.observe(link, { _tag: 'Gap', resume })),
        );
        continue;
      }
      yield* Effect.sleep(RESUBSCRIBE_MS);
    }
  });
}

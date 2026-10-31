import { Clock, Deferred, Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { sameProcess } from '@runlith/executions/protocol/evidence';
import { uuidv7 } from 'uuidv7';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { type WriteSet, writes } from '../../platform/contract/service/writes.js';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { HarnessRoad } from '../../threads/contract/wire/harness/seat.js';
import type { TransportBinding, TransportCapabilities } from '@runlith/agent/thread/record';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { observationRebound } from '../observations/staleness.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import { harnessSessionActive, type HarnessSession } from '../../threads/contract/wire/harness/session.js';
import type { AdoptionRequest } from '../contract/service/sessions.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { SessionRows, StandingSession } from '../contract/service/sessionRows.js';

export type SessionChange<A> = { readonly facet: ExternalSession; readonly value: A };
type SessionArgv = (facet: ExternalSession, id: string, asked: HarnessAskedModel | undefined) => Effect.Effect<readonly string[] | null, HarnessFailure>;
type SessionAcceptance = { readonly writes: WriteSet; readonly run: (session: HarnessSession, unit: WriteUnit<'machine'>) => Effect.Effect<void, HarnessFailure> };
export type SessionOpening = { readonly session: HarnessSession; readonly created: boolean; readonly announce: Effect.Effect<void, HarnessFailure> };

export type SessionPublished = (threadId: string, facet: ExternalSession) => Effect.Effect<void, HarnessFailure>;

const heartbeatOnly = (facet: ExternalSession, current: ExternalSession): boolean =>
  facet.session !== undefined &&
  current.session !== undefined &&
  sameExcept(facet, current, ['session']) &&
  sameExcept(facet.session, current.session, ['heartbeatAt']);
const sameExcept = (left: object, right: object, skip: readonly string[]): boolean => {
  const l = left as Record<string, unknown>;
  const r = right as Record<string, unknown>;
  return (
    Object.keys(l).every((key) => skip.includes(key) || l[key] === r[key]) &&
    Object.keys(r).every((key) => skip.includes(key) || l[key] === r[key])
  );
};

export class HarnessSessionStore {
  constructor(
    private readonly rows: SessionRows['Service'],
    private readonly published: SessionPublished,
  ) {
    this.changing = rows.writes;
  }
  private readonly changing: WriteSet;
  private readonly joinedSets = new WeakMap<WriteSet, WriteSet>();
  private readonly listeners = new Map<string, Set<(facet: ExternalSession) => void>>();

  wait(threadId: string, accepts: (facet: ExternalSession) => boolean): Effect.Effect<ExternalSession | null, StoreFailure | GateRefusal> {
    const { listeners: registry } = this;
    return Effect.acquireUseRelease(
      Effect.gen(function* () {
        const answer = yield* Deferred.make<ExternalSession>();
        const listeners = registry.get(threadId) ?? new Set<(facet: ExternalSession) => void>();
        registry.set(threadId, listeners);
        const changed = (facet: ExternalSession) => {
          if (accepts(facet)) Deferred.doneUnsafe(answer, Effect.succeed(facet));
        };
        listeners.add(changed);
        return { answer, listeners, changed };
      }),
      ({ answer }) =>
        Effect.flatMap(this.read(threadId), (facet) => (facet === null || accepts(facet) ? Effect.succeed(facet) : Deferred.await(answer))),
      ({ listeners, changed }) =>
        Effect.sync(() => {
          listeners.delete(changed);
          if (listeners.size === 0) registry.delete(threadId);
        }),
    );
  }
  private changingWith(joined: WriteSet | undefined): WriteSet {
    if (joined === undefined) return this.changing;
    const known = this.joinedSets.get(joined);
    if (known !== undefined) return known;
    const set = writes(this.changing.operation, [], this.changing, joined);
    this.joinedSets.set(joined, set);
    return set;
  }
  read(threadId: string): Effect.Effect<ExternalSession | null, StoreFailure | GateRefusal> {
    return this.rows.inspect((unit) => this.readIn(threadId, unit));
  }
  change<A>(
    threadId: string,
    work: (facet: ExternalSession, unit: WriteUnit<'machine'>) => Effect.Effect<SessionChange<A>, HarnessFailure>,
    joined?: WriteSet,
  ): Effect.Effect<A, HarnessFailure> {
    return Effect.flatMap(this.settle(threadId, work, joined), (settled) => Effect.as(this.announce(threadId, settled), settled.value));
  }
  announce(threadId: string, settled: { readonly facet: ExternalSession; readonly moved: boolean }): Effect.Effect<void, HarnessFailure> {
    return settled.moved ? Effect.withSpan(this.published(threadId, settled.facet), 'HarnessSessionStore.publish') : Effect.void;
  }
  settle<A>(
    threadId: string,
    work: (facet: ExternalSession, unit: WriteUnit<'machine'>) => Effect.Effect<SessionChange<A>, HarnessFailure>,
    joined?: WriteSet,
  ): Effect.Effect<{ readonly value: A; readonly facet: ExternalSession; readonly moved: boolean }, HarnessFailure> {
    const readIn = (unit: WriteUnit<'machine'>) => this.readIn(threadId, unit);
    const landed = this.landed(threadId);
    return this.rows.within(this.changingWith(joined), (unit) =>
      Effect.gen(function* () {
        const current = yield* readIn(unit);
        if (current === null)
          return yield* new GateRefusal('harness-missing', `No external session ${threadId} stands here.`, [
            'read the project session list',
          ]);
        return yield* landed(current, yield* work(current, unit), unit);
      }),
    );
  }
  planned<A>(
    threadId: string,
    held: ExternalSession,
    identity: string,
    work: (facet: ExternalSession, unit: WriteUnit<'machine'>) => Effect.Effect<SessionChange<A>, HarnessFailure>,
    joined?: WriteSet,
  ): Effect.Effect<{ readonly value: A; readonly facet: ExternalSession; readonly moved: boolean } | null, HarnessFailure> {
    const { rows } = this;
    const landed = this.landed(threadId);
    return rows.planned(this.changingWith(joined), identity, (unit) =>
      Effect.andThen(
        rows.held(threadId, held, unit),
        Effect.flatMap(work(held, unit), (change) => landed(held, change, unit)),
      ),
    );
  }
  private landed(threadId: string) {
    const { rows, listeners } = this;
    return Effect.fnUntraced(function* <A>(current: ExternalSession, { facet, value }: SessionChange<A>, unit: WriteUnit<'machine'>) {
      const visible =
        facet !== current &&
        (facet.observation.revision !== current.observation.revision ||
          facet.session !== current.session ||
          facet.execution !== current.execution ||
          facet.sessionKey !== current.sessionKey ||
          facet.retiring !== current.retiring ||
          facet.turn?.run !== current.turn?.run ||
          facet.turn?.openedAt !== current.turn?.openedAt ||
          facet.interrupted?.at !== current.interrupted?.at ||
          facet.name !== current.name);
      if (facet !== current) yield* rows.write(threadId, facet, unit);
      const moved = visible && !heartbeatOnly(facet, current);
      if (moved)
        yield* unit.afterCommit(
          Effect.sync(() => {
            for (const changed of listeners.get(threadId) ?? []) changed(facet);
          }),
        );
      return { value, facet, moved };
    });
  }
  open(
    threadId: string,
    prompt: string,
    ownerId: string,
    argvOf: SessionArgv,
    accepted?: SessionAcceptance,
    run?: string,
  ): Effect.Effect<HarnessSession, HarnessFailure> {
    return Effect.flatMap(this.opening(threadId, prompt, ownerId, argvOf, accepted, run), (opened) =>
      Effect.as(opened.announce, opened.session),
    );
  }
  opening(
    threadId: string,
    prompt: string,
    ownerId: string,
    argvOf: SessionArgv,
    accepted?: SessionAcceptance,
    run?: string,
  ): Effect.Effect<SessionOpening, HarnessFailure> {
    return Effect.map(this.settle(
      threadId,
      (facet, unit): Effect.Effect<SessionChange<{ readonly session: HarnessSession; readonly created: boolean }>, HarnessFailure> => {
        if (facet.retiring) return new GateRefusal('session-deleting', 'This session is being deleted.', ['finish deleting this session']);
        if (harnessSessionActive(facet.session)) return Effect.succeed({ facet, value: { session: facet.session, created: false } });
        if (run !== undefined && facet.turn?.run !== run)
          return new GateRefusal('run-stopped', `Run ${run} was stopped before its CLI started, so none is started for it.`, [
            'send the words again to start a new run',
          ]);
        const id = uuidv7();
        return Effect.flatMap(
          Effect.flatMap(this.asked(threadId, unit), (asked) => argvOf(facet, id, asked)),
          (argv) =>
            Effect.flatMap(Clock.currentTimeMillis, (at) => {
              const now = new Date(at).toISOString();
              const session: HarnessSession = {
                id,
                origin: 'launched',
                state: 'starting',
                prompt,
                cwd: null,
                argv,
                ownerId,
                startedAt: now,
                heartbeatAt: now,
              };
              const observation = observationRebound(facet.observation, { sessionId: session.id, execution: null, rootKey: null });
              const { interrupted: _past, ...unmarked } = facet;
              return (accepted?.run(session, unit) ?? Effect.void).pipe(
                Effect.as({ facet: { ...unmarked, execution: null, session, observation }, value: { session, created: true } }),
              );
            }),
        );
      },
      accepted?.writes,
    ), (settled) => ({ ...settled.value, announce: this.announce(threadId, settled) }));
  }
  adopted(threadId: string, adoption: AdoptionRequest, ownerId: string): Effect.Effect<HarnessSession, HarnessFailure> {
    return this.change(threadId, (facet) =>
      Effect.flatMap(Clock.currentTimeMillis, (at): Effect.Effect<SessionChange<HarnessSession>, HarnessFailure> => {
        if (facet.retiring) return new GateRefusal('session-deleting', 'This session is being deleted.', ['finish deleting this session']);
        const standing = facet.session;
        if (harnessSessionActive(standing)) {
          const here =
            standing.origin === 'adopted' &&
            standing.job !== undefined &&
            sameProcess(standing.job, adoption.job) &&
            facet.execution?.execution === adoption.shell.execution &&
            facet.execution.incarnation === adoption.shell.incarnation;
          if (here) return Effect.succeed({ facet, value: standing });
          return new GateRefusal(
            'session-elsewhere',
            `Thread ${threadId} already runs this CLI session in ${facet.execution === null ? 'a process being started' : `execution ${facet.execution.execution}`}; one CLI session is one process.`,
            ['stop that session first, then start the CLI in this terminal again', 'open that thread to reach the process it runs'],
          );
        }
        const now = new Date(at).toISOString();
        const session: HarnessSession = {
          id: uuidv7(),
          origin: 'adopted',
          job: adoption.job,
          state: 'running',
          prompt: '',
          cwd: adoption.cwd,
          argv: null,
          ownerId,
          startedAt: now,
          heartbeatAt: now,
          storage: adoption.storage,
        };
        const observation = observationRebound(facet.observation, {
          sessionId: session.id,
          execution: adoption.shell,
          rootKey: adoption.key,
        });
        const { interrupted: _past, ...unmarked } = facet;
        return Effect.succeed({ facet: { ...unmarked, execution: adoption.shell, session, observation }, value: session });
      }),
    );
  }
  claim(threadId: string, ownerId: string, staleBefore: Date): Effect.Effect<ExternalSession, HarnessFailure> {
    return this.change(threadId, (facet) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) => {
        const session = facet.session;
        if (!harnessSessionActive(session)) return Effect.succeed({ facet, value: facet });
        const holder = session.ownerId ?? null;
        if (holder !== null && holder !== ownerId && Date.parse(session.heartbeatAt ?? session.startedAt) >= staleBefore.getTime())
          return new GateRefusal('session-owned', `External session ${session.id} is observed by a live server.`, [
            'use that server, or retry after its ownership expires',
          ]);
        const written = { ...facet, session: { ...session, ownerId, heartbeatAt: new Date(at).toISOString() } };
        return Effect.succeed({ facet: written, value: written });
      }),
    );
  }
  owned(
    threadId: string,
    sessionId: string,
    ownerId: string,
    change: (facet: ExternalSession, session: HarnessSession) => ExternalSession,
  ): Effect.Effect<ExternalSession | null, HarnessFailure> {
    return this.change(threadId, (facet) => {
      const session = facet.session;
      if (!session || session.id !== sessionId || session.ownerId !== ownerId || session.state === 'ended')
        return Effect.succeed({ facet, value: null });
      const written = change(facet, session);
      return Effect.succeed({ facet: written, value: written });
    });
  }
  sessionsStanding(transport: HarnessTransport): Effect.Effect<readonly StandingSession[], HarnessFailure> {
    return this.rows.sessionsStanding(transport);
  }
  standing(transport: HarnessTransport): Effect.Effect<readonly string[], HarnessFailure> {
    return this.rows.standing(transport);
  }
  parked(runIds: readonly string[]): Effect.Effect<boolean, HarnessFailure> {
    return this.rows.parked(runIds);
  }
  ended(runIds: readonly string[]): Effect.Effect<boolean, HarnessFailure> {
    return this.rows.ended(runIds);
  }
  activeAt(threadId: string): Effect.Effect<number, HarnessFailure> {
    return this.rows.activeAt(threadId);
  }
  beat(ownerId: string, transport: HarnessTransport, active: readonly string[]): Effect.Effect<readonly string[], HarnessFailure> {
    return this.rows.beat(ownerId, transport, active);
  }
  readIn(threadId: string, unit: Unit<'machine'>): Effect.Effect<ExternalSession | null, StoreFailure | GateRefusal> {
    return this.rows.read(threadId, unit);
  }
  asked(threadId: string, held?: Unit<'machine'>): Effect.Effect<HarnessAskedModel | undefined, StoreFailure> {
    return held === undefined ? this.rows.inspect((unit) => this.rows.asked(threadId, unit)) : this.rows.asked(threadId, held);
  }
  ranOn(runId: string): Effect.Effect<HarnessAskedModel | undefined, StoreFailure> {
    return this.rows.ranOn(runId);
  }
  threadOfRun(runId: string): Effect.Effect<string | null, StoreFailure> {
    return this.rows.threadOfRun(runId);
  }
  road(threadId: string): Effect.Effect<HarnessRoad, StoreFailure> {
    return this.rows.road(threadId);
  }
  choose(
    threadId: string,
    asked: HarnessAskedModel | undefined,
    switches?: ModelSwitches,
    account?: string | null,
  ): Effect.Effect<void, HarnessFailure> {
    const chosen = (unit: WriteUnit<'machine'>) => this.rows.choose(threadId, asked, switches, account, unit);
    if (account === undefined) return this.rows.within(this.rows.choosing, chosen);
    return this.change(
      threadId,
      (facet, unit) =>
        Effect.as(chosen(unit), {
          facet:
            facet.session?.account === undefined || facet.session.account.key === account
              ? facet
              : { ...facet, session: { ...facet.session, account: undefined } },
          value: undefined,
        }),
      this.rows.choosing,
    );
  }
  switches(threadId: string, held?: Unit<'machine'>): Effect.Effect<ModelSwitches, StoreFailure> {
    return held === undefined ? this.rows.inspect((unit) => this.rows.switches(threadId, unit)) : this.rows.switches(threadId, held);
  }
  capabilities(threadId: string): Effect.Effect<TransportCapabilities | undefined, StoreFailure> {
    return this.rows.capabilities(threadId);
  }
  binding(threadId: string, held?: Unit<'machine'>): Effect.Effect<TransportBinding | undefined, StoreFailure> {
    return held === undefined ? this.rows.inspect((unit) => this.rows.binding(threadId, unit)) : this.rows.binding(threadId, held);
  }
}

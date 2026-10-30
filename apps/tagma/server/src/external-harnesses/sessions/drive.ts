import type { Settings } from '../../settings/contract/service/values.js';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { Cause, Clock, Deferred, Duration, Effect, Fiber, FiberMap, FileSystem, Option, type Scope } from 'effect';
import { CurrentActivity, defected } from '@runlith/activity/Activity';
import { ActivityLog } from '@runlith/activity/log';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { harnessAdapter } from '../contract/service/table.js';
import type { SessionProcesses } from '../contract/service/sessions.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import { harnessSessionActive, type HarnessProcessOutcome, type HarnessSession } from '../../threads/contract/wire/harness/session.js';
import { principalOf } from '../../executions/terminals/principals.js';
import type { TerminalOperationKey } from '../../executions/contract/wire/requestKeys.js';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import { TerminalEndings as ExecutionEndings } from '../../executions/contract/service/endings.js';
import type { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from '../../executions/contract/service/records.js';
import type { TerminalRequests, Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { HostManagement } from '../../executions/contract/service/host.js';
import { SessionLifecycle } from './lifecycleDriver.js';
import { SessionRoots } from './roots.js';
import { SessionLauncher } from './launcher.js';
import type { SessionAlignment } from './alignment.js';
import { SessionLease } from './lease.js';
import type { SessionPlace } from '../protocol/prompts.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { HarnessLanes } from './lanes.js';
import type { SessionObservations } from '../contract/service/observations.js';
import { HarnessSessionStore } from '../store/sessions.js';
import type { AdoptionRequest } from '../contract/service/sessions.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import { executionHandshakeMs } from '../../executions/contract/wire/terminalBehavior.js';
import { readHarnessFrame, typeHarnessKeys, typeHarnessWords, widgetOn, type HarnessKeyed, type HarnessTyped } from './keyboard.js';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import type { HarnessWidgetKey } from '@runlith/tagma/adapter/harness';
import { readsScreen, widgetStands } from '../adapter/screenAsk.js';
import { terminalArgv, type ProjectDeclaring } from './launch.js';
import { causeLine, endsAbortedWhenGone, shellEndedLine, forgetKept, BACKGROUND_WORDS } from './lifecycle.js';
import type { TerminalEndings } from '../terminal/endings.js';
import type { TerminalWords } from '../terminal/words.js';

const READY_POLL = Duration.millis(50);

type SessionReleased = (threadId: string, session: HarnessSession) => Effect.Effect<void, HarnessFailure>;

export type Seat =
  | { readonly _tag: 'None' }
  | { readonly _tag: 'Typable'; readonly execution: HarnessExecutionRef }
  | { readonly _tag: 'Refused'; readonly reason: string };

export type Keyboard = {
  readonly words: (text: string) => Effect.Effect<HarnessTyped, HarnessFailure>;
  readonly draft: (text: string) => Effect.Effect<HarnessTyped, HarnessFailure>;
  readonly keys: (keys: readonly HarnessWidgetKey[], operation: string) => Effect.Effect<HarnessKeyed, HarnessFailure>;
  readonly asking: Effect.Effect<boolean, HarnessFailure>;
  readonly lines: Effect.Effect<readonly string[], HarnessFailure>;
  readonly composer: Effect.Effect<string | null, HarnessFailure>;
};

type Driving = SessionProcesses;

export class SessionDriver implements Driving {
  readonly lease: SessionLease;
  private readonly roots: SessionRoots;
  private readonly lifecycle: SessionLifecycle;
  private readonly launcher: SessionLauncher;

  constructor(
    private readonly store: HarnessSessionStore,
    records: ThreadRecords['Service'],
    private readonly terminals: Terminals['Service'],
    private readonly screens: TerminalScreens['Service'],
    private readonly writing: TerminalWriting['Service'],
    executionRecords: ExecutionRecords['Service'],
    requests: TerminalRequests['Service'],
    evidence: ExecutionProcessEvidence['Service'],
    discharge: Discharge['Service'],
    host: HostManagement['Service'],
    place: SessionPlace,
    private readonly released: SessionReleased,
    private readonly endings: TerminalEndings,
    private readonly words: TerminalWords,
    private readonly observations: SessionObservations['Service'],
    private readonly lanes: HarnessLanes,
    private readonly fibers: FiberMap.FiberMap<string, void, never>,
    owners: FiberMap.FiberMap<string, void, never>,
    idle: FiberMap.FiberMap<string, void, never>,
    private readonly ownerId: string,
    access: Environments['Service'],
    scratch: ScratchAreas['Service'],
    settings: Settings['Service'],
    grants: GrantSigner['Service'],
    accounts: HarnessAccounts['Service'],
    private readonly providers: ProviderRegistry['Service'],
    cli: readonly string[],
    declaring: ProjectDeclaring,
    private readonly alignment: SessionAlignment,
    private readonly realigns: FiberMap.FiberMap<string, void, HarnessFailure>,
    files: FileSystem.FileSystem,
    private readonly executionEndings: ExecutionEndings['Service'],
    private readonly log: ActivityLog,
  ) {
    this.lease = new SessionLease(store, terminals, executionEndings, endings, owners, idle, ownerId, (threadId) => this.attend(threadId));
    this.roots = new SessionRoots(
      scratch,
      store,
      access,
      terminals,
      writing,
      executionRecords,
      discharge,
      observations,
      (threadId, sessionId, outcome, failure) => this.finish(threadId, sessionId, outcome, failure),
      (threadId, held) => endings.held(threadId, held),
    );
    this.lifecycle = new SessionLifecycle(
      store,
      records,
      terminals,
      screens,
      writing,
      evidence,
      requests,
      lanes,
      fibers,
      ownerId,
      (threadId, sessionId, outcome, failure, options) => this.finish(threadId, sessionId, outcome, failure, options),
    );
    this.launcher = new SessionLauncher(
      store,
      terminals,
      requests,
      host,
      settings,
      grants,
      accounts,
      providers,
      scratch,
      this.roots,
      alignment,
      place,
      ownerId,
      cli,
      (threadId, sessionId, outcome, failure) => this.finish(threadId, sessionId, outcome, failure),
      (threadId, sessionId, failure) => this.uncertain(threadId, sessionId, failure),
      (threadId, sessionId, cause, reason) => this.unsent(threadId, sessionId, cause, reason),
      files,
      declaring,
    );
  }

  static make(
    store: HarnessSessionStore,
    records: ThreadRecords['Service'],
    terminals: Terminals['Service'],
    screens: TerminalScreens['Service'],
    writing: TerminalWriting['Service'],
    executionRecords: ExecutionRecords['Service'],
    requests: TerminalRequests['Service'],
    evidence: ExecutionProcessEvidence['Service'],
    discharge: Discharge['Service'],
    host: HostManagement['Service'],
    place: SessionPlace,
    released: SessionReleased,
    endings: TerminalEndings,
    words: TerminalWords,
    observations: SessionObservations['Service'],
    lanes: HarnessLanes,
    access: Environments['Service'],
    scratch: ScratchAreas['Service'],
    settings: Settings['Service'],
    grants: GrantSigner['Service'],
    accounts: HarnessAccounts['Service'],
    providers: ProviderRegistry['Service'],
    cli: readonly string[],
    declaring: ProjectDeclaring,
    alignment: SessionAlignment,
    ownerId: string = crypto.randomUUID(),
  ): Effect.Effect<SessionDriver, never, Scope.Scope | FileSystem.FileSystem | ExecutionEndings> {
    return Effect.flatMap(
      Effect.all([
        FiberMap.make<string, void, never>(),
        FiberMap.make<string, void, never>(),
        FiberMap.make<string, void, never>(),
        FiberMap.make<string, void, HarnessFailure>(),
        FileSystem.FileSystem,
        ExecutionEndings,
        ActivityLog,
      ]),
      ([fibers, owners, idle, realigns, files, executionEndings, log]) => {
        const driver = new SessionDriver(
          store,
          records,
          terminals,
          screens,
          writing,
          executionRecords,
          requests,
          evidence,
          discharge,
          host,
          place,
          released,
          endings,
          words,
          observations,
          lanes,
          fibers,
          owners,
          idle,
          ownerId,
          access,
          scratch,
          settings,
          grants,
          accounts,
          providers,
          cli,
          declaring,
          alignment,
          realigns,
          files,
          executionEndings,
          log,
        );
        return Effect.as(Effect.forkScoped(driver.lease.beating()), driver);
      },
    );
  }

  readonly launch = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, runId: string | null, words: string) {
    yield* this.reattend(threadId);
    const { models } = yield* this.providers.catalog;
    const session = yield* this.store.open(threadId, words, this.ownerId, terminalArgv(models, words), undefined, runId ?? undefined);
    yield* this.attend(threadId);
    return session;
  }, Effect.uninterruptible);

  readonly adopt = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, adoption: AdoptionRequest) {
    yield* this.reattend(threadId);
    const session = yield* this.store.adopted(threadId, adoption, this.ownerId);
    yield* this.attend(threadId);
    return session;
  }, Effect.uninterruptible);

  private readonly reattend = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    if ((yield* this.store.read(threadId))?.session?.state !== 'uncertain') return;
    yield* this.lease.raise(threadId);
  });

  readonly seat = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const facet = yield* this.store.read(threadId);
    const session = facet?.session;
    if (facet === null || !harnessSessionActive(session)) return { _tag: 'None' } as const satisfies Seat;
    if (facet.retiring === true || session.state === 'stopping') {
      return { _tag: 'Refused', reason: 'The CLI is being stopped.' } as const satisfies Seat;
    }
    const execution = facet.execution;
    if (session.state !== 'running' || execution === null) {
      return { _tag: 'Refused', reason: 'The CLI is still starting.' } as const satisfies Seat;
    }
    if (session.origin === 'adopted') {
      const job = yield* this.lifecycle.jobOf(execution, session.job);
      if (job !== 'foreground') {
        yield* this.observations.notedWords(threadId, 'cli-background', BACKGROUND_WORDS[job]);
        return { _tag: 'Refused', reason: BACKGROUND_WORDS[job] } as const satisfies Seat;
      }
    }
    return { _tag: 'Typable', execution } as const satisfies Seat;
  });

  lines(execution: HarnessExecutionRef): Effect.Effect<readonly string[], HarnessFailure> {
    return Effect.map(readHarnessFrame(this.terminals, this.screens, execution), screenLines);
  }

  typing<A>(
    threadId: string,
    execution: HarnessExecutionRef,
    act: (keyboard: Keyboard) => Effect.Effect<A, HarnessFailure>,
  ): Effect.Effect<A, HarnessFailure> {
    const { store, lanes, terminals, screens, writing } = this;
    return Effect.flatMap(store.read(threadId), (facet) => {
      const session = facet?.session;
      if (facet === null || session === undefined) {
        return new GateRefusal('typing-unavailable', `No session of ${threadId} stands to type into.`, [
          'start the session before typing into it',
        ]);
      }
      const frame = readHarnessFrame(terminals, screens, execution);
      const composer = harnessAdapter(facet.name).composer;
      return lanes.typing(session.id, (lane) =>
        act({
          words: (text) => typeHarnessWords(terminals, screens, writing, lane, execution, text),
          draft: (text) => typeHarnessWords(terminals, screens, writing, lane, execution, text, false),
          keys: (keys, operation) => typeHarnessKeys(terminals, screens, writing, lane, execution, keys, operation),
          asking: readsScreen(harnessAdapter(facet.name))
            ? Effect.map(frame, (shown) => widgetStands(widgetOn(facet.name, shown)))
            : Effect.succeed(false),
          lines: this.lines(execution),
          composer: composer === undefined ? Effect.succeed(null) : Effect.map(this.lines(execution), composer.of),
        }),
      );
    });
  }

  readonly seated = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const { store, lanes, ownerId } = this;
    yield* this.lease.raise(threadId);
    for (;;) {
      const facet = yield* store.wait(
        threadId,
        (standing) =>
          !harnessSessionActive(standing.session) || (standing.session.state !== 'starting' && standing.session.ownerId === ownerId),
      );
      const session = facet?.session;
      if (facet === null || !harnessSessionActive(session) || session.state !== 'running' || facet.execution === null) return null;
      if (lanes.held(session.id)) return facet.execution;
      yield* Effect.sleep(READY_POLL);
    }
  });

  readonly ready = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const { store, lanes, terminals, screens, ownerId } = this;
    yield* this.lease.raise(threadId);
    for (;;) {
      const facet = yield* store.wait(threadId, (standing) => standing.session?.state !== 'starting');
      const session = facet?.session;
      if (facet === null || !harnessSessionActive(session) || session.state !== 'running' || facet.execution === null) return;
      if (session.ownerId !== ownerId) return;
      if (lanes.held(session.id)) {
        const record = yield* terminals
          .record(facet.execution.execution, facet.execution.incarnation)
          .pipe(Effect.mapError((cause) => threadCallFailed(cause)));
        if (record === null) return;
        const update = yield* screens.screen(record.execution).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
        if (update._tag === 'ScreenUnavailable' || (update.input._tag === 'Available' && update.input.bracketedPaste)) return;
      }
      yield* Effect.sleep(READY_POLL);
    }
  });

  readonly aligned = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const { realigns } = this;
    yield* FiberMap.run(realigns, threadId, this.realign(threadId), { onlyIfMissing: true });
    const standing = yield* FiberMap.get(realigns, threadId).pipe(Effect.option);
    if (Option.isSome(standing) && Option.isSome(standing.value)) yield* Fiber.join(standing.value.value);
  });

  private readonly realign = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const facet = yield* this.store.wait(threadId, (standing) => standing.session?.state !== 'starting');
    const session = facet?.session;
    if (
      facet === null ||
      !harnessSessionActive(session) ||
      session.state !== 'running' ||
      session.origin === 'adopted' ||
      facet.execution === null ||
      facet.turn !== undefined ||
      facet.retiring === true
    )
      return;
    if (!(yield* this.alignment.due(threadId))) return;
    const seat = yield* this.seat(threadId);
    const drafted = seat._tag === 'Typable' ? yield* this.composerOf(threadId, seat.execution) : null;
    if ((yield* this.stop(threadId, session.id, true)) === 'not-running') return;
    yield* this.launch(threadId, null, '');
    const text = drafted?.trim() ?? '';
    if (text === '') return;
    yield* this.ready(threadId);
    const execution = (yield* this.store.read(threadId))?.execution;
    if (execution === null || execution === undefined) return;
    yield* this.typing(threadId, execution, (keyboard) => keyboard.draft(text));
  });

  private readonly composerOf = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, execution: HarnessExecutionRef) {
    const read = yield* Effect.result(this.typing(threadId, execution, (keyboard) => keyboard.composer));
    if (read._tag === 'Success') return read.success;
    yield* Effect.logWarning('the composer of a CLI being aligned could not be read; its unsent text is not carried', {
      threadId,
      cause: read.failure,
    });
    return null;
  });

  readonly stop = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, expectedId?: string, idle = false) {
    const { store, fibers } = this;
    const marked = yield* store.change(threadId, (facet) => {
      const session = facet.session;
      if (
        !harnessSessionActive(session) ||
        (expectedId !== undefined && expectedId !== session.id) ||
        (idle && (facet.turn !== undefined || session.state !== 'running'))
      ) {
        return Effect.succeed({ facet, value: null });
      }
      return Effect.succeed({
        facet: {
          ...facet,
          session: { ...session, state: 'stopping' as const },
        },
        value: { state: session.state },
      });
    });
    if (marked === null) return 'not-running' as const;
    yield* this.attend(threadId);
    const facet = yield* store.read(threadId);
    if (facet?.session?.origin === 'adopted') return yield* this.lifecycle.quit(threadId, facet.session.id, marked);
    if (facet?.execution && facet.session) yield* this.stopExecution(threadId, facet);
    const watching = yield* FiberMap.get(fibers, threadId).pipe(Effect.option);
    if (Option.isSome(watching) && Option.isSome(watching.value)) {
      yield* Fiber.await(watching.value.value);
      if ((yield* store.read(threadId))?.session?.state === 'stopping') {
        yield* this.attend(threadId);
        const driving = yield* FiberMap.get(fibers, threadId).pipe(Effect.option);
        if (Option.isSome(driving) && Option.isSome(driving.value)) yield* Fiber.await(driving.value.value);
      }
    } else {
      yield* store
        .wait(threadId, (settled) => settled.session?.state !== 'stopping')
        .pipe(Effect.timeoutOption(Duration.millis(executionHandshakeMs)));
    }
    const standing = (yield* store.read(threadId))?.session;
    if (standing === undefined || standing.state === 'ended') return 'stopped' as const;
    return yield* new GateRefusal('session-uncertain', 'The execution ending is unknown.', [
      'read this session’s execution in the project’s terminal inventory and stop it there',
      'stop this session again once its execution answers',
    ]);
  });

  readonly reconcile = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const standing = yield* FiberMap.get(this.fibers, threadId).pipe(Effect.option);
    if (Option.isSome(standing) && Option.isSome(standing.value)) yield* Fiber.await(standing.value.value);
    yield* this.lease.raise(threadId);
  });

  readonly alive = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const facet = yield* this.store.read(threadId);
    if (facet === null || !harnessSessionActive(facet.session)) return false;
    return (yield* this.lifecycle.measure(threadId, facet))._tag === 'Standing';
  });

  private readonly attend = Effect.fnUntraced(function* (this: SessionDriver, threadId: string) {
    const { fibers, store, lanes, ownerId } = this;
    if (yield* FiberMap.has(fibers, threadId)) return;
    const now = yield* Clock.currentTimeMillis;
    const facet = yield* store.claim(threadId, ownerId, new Date(now - LEASE_RHYTHM.takeoverAfterMs));
    if (!harnessSessionActive(facet.session)) return;
    if (facet.session.state === 'uncertain') return yield* this.lifecycle.reconcile(threadId, facet);
    const session = facet.session;
    const attended = this.drive(threadId, facet).pipe(
      Effect.ensuring(lanes.close(session.id)),
      Effect.catchCause((cause) => Effect.andThen(this.told(threadId, cause), this.uncertain(threadId, session.id, causeLine(cause)))),
      Effect.ensuring(
        store
          .owned(threadId, session.id, ownerId, (current, held) => ({ ...current, session: { ...held, ownerId: null } }))
          .pipe(
            Effect.catchCause((cause) => Effect.logWarning('external session handover failed', { threadId, cause: Cause.pretty(cause) })),
          ),
      ),
    );
    yield* FiberMap.run(fibers, threadId, attended, { onlyIfMissing: true });
  });

  private readonly drive = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, facet: ExternalSession) {
    const { lease, terminals, launcher, words, roots, lanes, executionEndings, lifecycle, store } = this;
    const session = facet.session!;
    if (session.origin === 'adopted') return yield* this.driveAdopted(threadId, facet);
    if (session.state === 'stopping' && facet.execution === null && session.cwd === null) {
      yield* this.finish(threadId, session.id, 'aborted', null);
      return;
    }
    const reconciled = lease.reconciled(threadId);
    let record =
      facet.execution === null
        ? null
        : reconciled !== undefined
          ? reconciled
          : yield* terminals
              .record(facet.execution.execution, facet.execution.incarnation)
              .pipe(Effect.mapError((cause) => threadCallFailed(cause)));
    if (facet.execution !== null && record === null) {
      yield* lifecycle.gone(threadId, session, facet.retiring);
      return;
    }
    const declaresExport = harnessAdapter(facet.name).launch?.export !== undefined;
    const launching = session.state !== 'stopping';
    if (record === null) {
      const launched = yield* launcher.launch(threadId, facet, session, launching, declaresExport);
      if (launched === null) return;
      record = launched;
      if (session.prompt.trim() !== '') yield* words.accepted(threadId, null);
    } else if (launching && declaresExport && session.exportPath !== undefined) {
      const provisioned = yield* roots.provisionPersistedExport(threadId, session.exportPath);
      if (provisioned !== 'ready') {
        yield* this.told(threadId, provisioned.cause);
        yield* this.uncertain(threadId, session.id, provisioned.reason);
        return;
      }
    }
    const execution = record.execution;
    const projectId = record.projectId;
    yield* lanes.open(session.id, projectId, execution, record.holder);
    const watching = executionEndings.decided({ projectId, execution });
    const ending = yield* lease.beaten(
      threadId,
      session.id,
      (current) =>
        current.session?.state === 'stopping'
          ? Effect.as(this.stopExecution(threadId, current), 'again' as const)
          : Effect.map(roots.witness(threadId, current), (tried) =>
              tried === 'named' || current.observation.binding.rootKey !== null || !roots.witnessed(current)
                ? ('done' as const)
                : ('again' as const),
            ),
      watching,
    );
    if (ending === 'lost' || ending === 'job') return;
    const current = yield* store.read(threadId);
    const driven = current?.session?.id === session.id ? current.session : session;
    if (ending._tag === 'Unwatchable') {
      yield* lifecycle.gone(threadId, driven, current?.retiring);
      return;
    }
    yield* lifecycle.exited(threadId, driven, ending.summary.state.nativeExit, facet.execution);
  });

  private readonly driveAdopted = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, facet: ExternalSession) {
    const { terminals, lanes, lifecycle, executionEndings, store } = this;
    const session = facet.session!;
    const shell = facet.execution;
    const witness = session.job;
    if (shell === null || witness === undefined) {
      return yield* this.finish(threadId, session.id, 'failed', 'An adopted session names no terminal or job to follow.');
    }
    const record = yield* terminals.record(shell.execution, shell.incarnation).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
    if (record === null) return yield* this.shellEnded(threadId, session, shell.execution);
    yield* lanes.open(session.id, record.projectId, record.execution, record.holder, lifecycle.foreground(shell, witness));
    const watching = executionEndings
      .decided({ projectId: record.projectId, execution: record.execution })
      .pipe(Effect.as('shell' as const));
    const ending = yield* this.lease.beaten(
      threadId,
      session.id,
      (_current, signal) =>
        Effect.flatMap(lifecycle.jobOf(shell, witness), (job) =>
          job === 'gone' ? Effect.as(Deferred.succeed(signal, 'job'), 'again' as const) : Effect.succeed('again' as const),
        ),
      watching,
    );
    if (ending === 'lost') return;
    const current = yield* store.read(threadId);
    const driven = current?.session?.id === session.id ? current.session : session;
    if (ending === 'job') return yield* this.finish(threadId, session.id, 'completed', null, { stopWins: true });
    const closed = yield* terminals.stopAsked(record.execution).pipe(Effect.orElseSucceed(() => false));
    if (closed) return yield* this.finish(threadId, session.id, 'aborted', null);
    return yield* this.shellEnded(threadId, driven, shell.execution);
  });

  private shellEnded(threadId: string, session: HarnessSession, execution: string): Effect.Effect<void, HarnessFailure> {
    return this.finish(threadId, session.id, 'failed', shellEndedLine(execution), { stopWins: true });
  }

  private readonly stopExecution = Effect.fnUntraced(function* (this: SessionDriver, threadId: string, facet: ExternalSession) {
    const { terminals, lifecycle } = this;
    if (!facet.execution || !facet.session || facet.session.origin === 'adopted') return;
    const record = yield* terminals
      .record(facet.execution.execution, facet.execution.incarnation)
      .pipe(Effect.mapError((cause) => threadCallFailed(cause)));
    if (!record) return yield* lifecycle.gone(threadId, facet.session, facet.retiring);
    const key: TerminalOperationKey = {
      projectId: record.projectId,
      operationId: HostRequestKey.make(`harness-stop:${facet.session.id}`),
      requester: principalOf({ _tag: 'Operator' }),
      mutation: 'stop',
      targetKey: record.targetKey,
      execution: record.execution,
    };
    yield* terminals.stop(record.projectId, key, record.execution, record.revision, 'explicit-stop', 'signal').pipe(
      Effect.catchTag('TerminalRefused', (refusal) => (refusal.reason === 'operation-conflict' ? Effect.void : Effect.fail(refusal))),
      Effect.mapError((cause) => threadCallFailed(cause)),
    );
  });

  private readonly finish = Effect.fnUntraced(function* (
    this: SessionDriver,
    threadId: string,
    sessionId: string,
    outcome: HarnessProcessOutcome,
    failure: string | null,
    { stopWins = false }: { readonly stopWins?: boolean } = {},
  ) {
    const { roots, endings, store, ownerId, released } = this;
    yield* roots
      .settleHeld(threadId, sessionId)
      .pipe(Effect.catch((cause) => Effect.logWarning('held answers could not be settled at the ending', { threadId, cause })));
    const spent = yield* endings.settle(threadId);
    const written = yield* store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const session = facet.session;
          if (!session || session.id !== sessionId || session.ownerId !== ownerId || session.state === 'ended') {
            return { facet, value: null };
          }
          const stopped = stopWins && endsAbortedWhenGone(session, facet.retiring);
          const settled = stopped ? 'aborted' : outcome;
          const reason = stopped ? null : failure;
          const reported = yield* endings.ended(
            facet,
            unit,
            threadId,
            {
              outcome: settled,
              failure: reason,
              launching: session.state === 'starting',
            },
            spent,
          );
          const ended: HarnessSession = {
            ...session,
            state: 'ended',
            ownerId: null,
            failure: settled === 'failed' ? (reason ?? undefined) : undefined,
          };
          return {
            facet: { ...reported.facet, session: ended },
            value: { session: ended, after: reported.after },
          };
        }),
      endings.writes,
    );
    if (written === null) return;
    yield* written.after;
    if (written.session.origin === 'adopted') {
      const key = (yield* store.read(threadId))?.sessionKey;
      if (key) yield* forgetKept(key);
    }
    yield* released(threadId, written.session);
  });

  private readonly unsent = Effect.fnUntraced(function* (
    this: SessionDriver,
    threadId: string,
    sessionId: string,
    cause: Cause.Cause<unknown>,
    reason?: string,
  ) {
    yield* this.told(threadId, cause);
    yield* this.finish(threadId, sessionId, 'failed', reason ?? `launch-failed: the CLI was not started — ${causeLine(cause)}`, {
      stopWins: true,
    });
  });

  private told(threadId: string, cause: Cause.Cause<unknown>): Effect.Effect<void> {
    return defected(cause, 'terminal drive', { thread: threadId }).pipe(
      Effect.provideService(ActivityLog, this.log),
      Effect.provideService(CurrentActivity, null),
    );
  }

  private uncertain(threadId: string, sessionId: string, failure: string): Effect.Effect<void> {
    return Effect.logWarning('an external session became uncertain', { threadId, sessionId, failure }).pipe(
      Effect.andThen(
        this.store.owned(threadId, sessionId, this.ownerId, (facet, session) => ({
          ...facet,
          session: { ...session, state: 'uncertain', failure },
        })),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning('external session state could not be recorded', { threadId, cause: Cause.pretty(cause) }),
      ),
    );
  }
}

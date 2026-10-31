import { Context, type Cause, Duration, Effect, Exit, FileSystem, Layer, type Queue, Ref, Scope, Semaphore, Stream } from 'effect';
import { Commands } from './Commands';
import { ExecutionCustody } from './ExecutionCustody';
import { ExecutionEvidence, type LoadSubscription } from './ExecutionEvidence';
import { ExecutionFeed } from './ExecutionFeed';
import { ExecutionRecord } from './ExecutionRecord';
import { ExecutionRequest } from './ExecutionRequest';
import {
  Executions,
  type ExecutionFeedItem,
  type ExecutionsFailure,
  HostRefused,
  type RecordChunk,
  WireInvalid,
  WireLost,
  WireUnavailable,
  WireUnreadable,
} from './Executions';
import { HostAuthority } from './HostAuthority';
import { HostLifecycle } from './HostLifecycle';
import { TerminalInput } from './TerminalInput';
import { TerminalLanes } from './TerminalLanes';
import { TerminalScreen } from './TerminalScreen';
import type { HostRequestRef, Incarnation } from './protocol/execution';
import type { InputRequest } from './protocol/input';
import { ForegroundRefusal } from './protocol/terminal';
import type { HostAddress } from './hostAddress';
import { HostRegistration } from './HostRegistration';
import { EndpointConnection } from './EndpointConnection';
import type { ConnectionId, HostCustody, HostCustodyRevision, Role } from './protocol/registration';
import type { CallAnswer } from './protocol/runtime';
import {
  type AuthorityAnswer,
  type AuthorityRequest,
  type InputFrame,
  type Request,
  type HostAnswer,
  type SubscriptionId,
  type SubscriptionSource,
  WireLimits,
} from './protocol/wire';
import { EMPTY_PAYLOAD } from './protocol/frames';
import type { HeldDelivery } from './WireReaders';
import { type Answer, laneOf } from './WireRequests';
import { type SessionBudget, type WireSession, wireSession } from './WireSession';

const expect = <T extends HostAnswer['_tag']>(
  tag: T,
  answer: Answer,
): Effect.Effect<Extract<HostAnswer, { readonly _tag: T }>, ExecutionsFailure> =>
  answer.response._tag === tag
    ? Effect.succeed(answer.response as Extract<HostAnswer, { readonly _tag: T }>)
    : answer.response._tag === 'Refused'
      ? Effect.fail(new HostRefused({ refusal: answer.response.refusal }))
      : Effect.fail(new WireUnreadable({ detail: `asked ${tag}, the host answered ${answer.response._tag}` }));

type Held = { readonly session: WireSession; readonly scope: Scope.Closeable };

export type SessionWelcome = { readonly connection: ConnectionId; readonly incarnation: Incarnation; readonly custody: HostCustody };

export type SessionTake = (operation: HostRequestRef, expected: HostCustodyRevision) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;

export type SessionOpened = (welcome: SessionWelcome, take: SessionTake) => Effect.Effect<void>;

type SubscriptionRequest = Parameters<WireSession['cancel']>[0];

type OpenReader = {
  readonly subscription: SubscriptionId;
  readonly queue: Queue.Dequeue<HeldDelivery, Cause.Done>;
};

export type ClientInput = {
  readonly address: HostAddress;
  readonly role: Role;
  readonly limits: WireLimits;
  readonly budget?: SessionBudget;
  readonly opened?: SessionOpened;
};

const make = Effect.fnUntraced(function* ({ address, role, limits, budget = {}, opened }: ClientInput) {
  const owner = yield* Effect.scope;
  const files = yield* FileSystem.FileSystem;
  const registrations = yield* HostRegistration;
  const connection = yield* EndpointConnection;
  const held = yield* Ref.make<Held | undefined>(undefined);
  const connecting = yield* Semaphore.make(1);

  const session = Effect.fnUntraced(
    function* () {
      const standing = yield* Ref.get(held);
      if (standing !== undefined && (yield* standing.session.alive)) return standing.session;
      if (standing !== undefined) yield* Scope.close(standing.scope, Exit.void);
      const scope = yield* Scope.fork(owner);
      return yield* wireSession(address, role, limits, budget).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.provideService(HostRegistration, registrations),
        Effect.provideService(EndpointConnection, connection),
        Effect.provideService(Scope.Scope, scope),
        Effect.tap((connected) => Ref.set(held, { session: connected, scope })),
        Effect.tap((connected) =>
          opened === undefined
            ? Effect.void
            : opened(
                {
                  connection: connected.welcome.connection,
                  incarnation: connected.welcome.incarnation,
                  custody: connected.welcome.custody,
                },
                (operation, expected) => authorityOn(connected, { _tag: 'TakeHost', operation, expected }),
              ),
        ),
        Effect.onError(() =>
          Effect.andThen(
            Ref.update(held, (standing) => (standing?.scope === scope ? undefined : standing)),
            Scope.close(scope, Exit.void),
          ),
        ),
      );
    },
    (effect) => connecting.withPermits(1)(effect),
  );

  yield* Effect.addFinalizer(() =>
    connecting.withPermits(1)(
      Effect.gen(function* () {
        const standing = yield* Ref.getAndSet(held, undefined);
        if (standing !== undefined) yield* Scope.close(standing.scope, Exit.void);
      }),
    ),
  );

  const over = (session: WireSession, body: Request, payload: Uint8Array) =>
    session.requests.ask(
      (request) => session.call(request, body, payload),
      (request) => Effect.andThen(session.cancel(request), session.readers.release(request)),
      laneOf(body._tag),
    );

  const authorityOn = Effect.fnUntraced(function* (session: WireSession, act: AuthorityRequest) {
    const answer = yield* over(session, { _tag: 'Authority', act }, EMPTY_PAYLOAD);
    const outcome = (yield* expect('Authority', answer)).outcome;
    if (outcome._tag === 'Held') yield* Ref.set(session.epoch, outcome.custody.epoch);
    return outcome;
  });

  const reader = Effect.fnUntraced(function* (
    session: WireSession,
    source: SubscriptionSource,
    credits: number,
  ): Effect.fn.Return<OpenReader, ExecutionsFailure> {
    const numbered = yield* Ref.make<SubscriptionRequest | undefined>(undefined);
    const answer = yield* session.requests
      .ask(
        (request) =>
          Effect.gen(function* () {
            yield* Ref.set(numbered, request);
            const reserved = yield* session.readers.reserve(request, credits);
            if (reserved === undefined) {
              return yield* new HostRefused({
                refusal: {
                  _tag: 'CapacityExceeded',
                  reason: `this connection already holds ${session.limits.subscriptions} subscriptions`,
                },
              });
            }
            return yield* session.call(request, { _tag: 'Subscribe', source, credits }, EMPTY_PAYLOAD);
          }),
        (request) => Effect.andThen(session.cancel(request), session.readers.release(request)),
        laneOf('Subscribe'),
      )
      .pipe(
        Effect.tapError(() =>
          Effect.flatMap(Ref.get(numbered), (request) => (request === undefined ? Effect.void : session.readers.release(request))),
        ),
      );
    if (answer.response._tag !== 'Subscribed') {
      yield* session.readers.release(answer.request);
      yield* expect('Subscribed', answer);
    }
    const subscription = (yield* expect('Subscribed', answer)).subscription;
    const queue = yield* session.readers.queueOf(subscription);
    if (queue === undefined) {
      return yield* new WireUnreadable({ detail: `the host named subscription ${subscription}, which this client is not holding` });
    }
    return { subscription, queue };
  });

  const surface = (connect: () => ReturnType<typeof session>) => {
    const ask = Effect.fnUntraced(function* (body: Request, payload: Uint8Array = EMPTY_PAYLOAD) {
      return yield* over(yield* connect(), body, payload);
    });

    const authority = (act: AuthorityRequest) => Effect.flatMap(connect(), (session) => authorityOn(session, act));

    const subscribed = Effect.fnUntraced(function* (source: SubscriptionSource, credits: number) {
      const connected = yield* connect();
      const opened = yield* Effect.acquireRelease(reader(connected, source, Math.min(credits, connected.limits.credits)), (reader) =>
        Effect.andThen(Effect.ignore(connected.unsubscribe(reader.subscription)), connected.readers.close(reader.subscription)),
      );
      const returned = Effect.fnUntraced(function* (cost: number) {
        if (cost <= 0) return;
        if (yield* connected.readers.grant(opened.subscription, cost)) {
          yield* connected.credit(opened.subscription, cost);
        }
      });
      return Stream.fromQueue(opened.queue).pipe(
        Stream.flatMap((held: HeldDelivery) =>
          Stream.concat(Stream.succeed(held.delivery), Stream.drain(Stream.fromEffect(returned(held.cost)))),
        ),
      );
    });

    const subscribe = (source: SubscriptionSource, credits: number): Stream.Stream<ExecutionFeedItem, ExecutionsFailure> =>
      Stream.unwrap(subscribed(source, credits));

    const decided = (operation: HostRequestRef, pending: CallAnswer, waitMs: number) => {
      if (pending._tag === 'Settled' || pending.execution === undefined) return Effect.succeed(pending);
      return Stream.runHead(
        Stream.filter(
          subscribe({ _tag: 'State', execution: pending.execution }, limits.credits),
          (delivery) => delivery._tag === 'State' && delivery.summary.decision !== undefined,
        ),
      ).pipe(
        Effect.andThen(
          ask({ _tag: 'CallResult', operation }).pipe(
            Effect.flatMap((answer) => Effect.map(expect('Call', answer), (response) => response.answer)),
          ),
        ),
        Effect.timeoutOrElse({ duration: Duration.millis(waitMs), orElse: () => Effect.succeed(pending) }),
      );
    };

    return {
      ...Executions.of({
        list: (options) =>
          ask({ _tag: 'List', limit: options?.limit ?? Number.MAX_SAFE_INTEGER, after: options?.after }).pipe(
            Effect.flatMap((answer) => expect('Listed', answer)),
            Effect.map((response) => response.page),
          ),

        changes: (since, limit) =>
          ask({ _tag: 'Changes', since, limit }).pipe(
            Effect.flatMap((answer) => expect('Changes', answer)),
            Effect.map((response) => response.changes),
          ),

        state: (execution) =>
          ask({ _tag: 'State', execution }).pipe(
            Effect.flatMap((answer) => expect('State', answer)),
            Effect.map((response) => response.summary),
          ),

        ending: (execution, remeasure) =>
          ask({ _tag: 'Ending', execution, remeasure: remeasure === true ? true : undefined }).pipe(
            Effect.flatMap((answer) => expect('Ending', answer)),
            Effect.map((response) =>
              response.receipt === undefined ? undefined : { ...response.receipt, measurement: response.measurement },
            ),
          ),

        retained: (execution) =>
          ask({ _tag: 'Retained', execution }).pipe(
            Effect.flatMap((answer) => expect('Retained', answer)),
            Effect.map((response) => response.record),
          ),

        start: (operation, launch) =>
          ask({ _tag: 'Start', operation, launch }).pipe(
            Effect.flatMap((answer) => expect('Start', answer)),
            Effect.map((response) => response.outcome),
          ),

        cancelStart: (operation, cause, trigger, when = 'always') =>
          ask({ _tag: 'CancelStart', operation, cause, trigger, when }).pipe(
            Effect.flatMap((answer) => expect('CancelStart', answer)),
            Effect.map((response) => response.outcome),
          ),

        signal: (execution, signal) =>
          ask({ _tag: 'Signal', execution, signal }).pipe(
            Effect.flatMap((answer) => expect('Signal', answer)),
            Effect.map((response) => response.outcome),
          ),

        stop: (operation, execution, cause, action, trigger) =>
          ask({ _tag: 'Stop', operation, execution, cause, action, trigger }).pipe(
            Effect.flatMap((answer) => expect('Stop', answer)),
            Effect.map((response) => response.receipt),
          ),

        retire: (operation, execution) =>
          ask({ _tag: 'Retire', operation, execution }).pipe(
            Effect.flatMap((answer) => expect('Retire', answer)),
            Effect.map((response) => response.outcome),
          ),
      }),

      ...Commands.of({
        command: (execution) =>
          ask({ _tag: 'Command', execution }).pipe(
            Effect.flatMap((answer) => expect('Command', answer)),
            Effect.map((response) => response.snapshot),
          ),

        commands: (query) =>
          ask({ _tag: 'Commands', query }).pipe(
            Effect.flatMap((answer) => expect('Commands', answer)),
            Effect.map((response) => response.inventory),
          ),

        commandsAt: (refs) =>
          ask({ _tag: 'CommandsAt', refs }).pipe(
            Effect.flatMap((answer) => expect('CommandsAt', answer)),
            Effect.map((response) => response.batch),
          ),

        revise: (request) =>
          ask({ _tag: 'Revise', request }).pipe(
            Effect.flatMap((answer) => expect('Revise', answer)),
            Effect.map((response) => response.outcome),
          ),
      }),

      ...ExecutionRequest.of({
        operation: (operation) =>
          ask({ _tag: 'Operation', operation }).pipe(
            Effect.flatMap((answer) => expect('Operation', answer)),
            Effect.map((response) => response.answer),
          ),

        callResult: (operation, options) =>
          ask({ _tag: 'CallResult', operation }).pipe(
            Effect.flatMap((answer) => expect('Call', answer)),
            Effect.map((response) => response.answer),
            Effect.flatMap((answer) =>
              answer._tag === 'Settled' || options?.waitMs === undefined
                ? Effect.succeed(answer)
                : decided(operation, answer, options.waitMs),
            ),
          ),
      }),

      ...ExecutionRecord.of({
        read: (cursor, limit) =>
          ask({ _tag: 'Read', cursor, limit }).pipe(
            Effect.flatMap((answer) =>
              Effect.map(expect('Read', answer), (response): RecordChunk => ({
                range: response.range,
                bytes: answer.payload,
                modes: response.modes,
              })),
            ),
          ),
      }),

      ...ExecutionFeed.of({ subscribe }),

      ...TerminalScreen.of({
        screen: (execution, request = {}) =>
          ask({ _tag: 'Screen', execution, base: request.base, cells: request.cells, scrollback: request.scrollback }).pipe(
            Effect.flatMap((answer) => expect('Screen', answer)),
            Effect.map((response) => response.answer),
          ),
        point: (execution, request = {}) =>
          ask({ _tag: 'ScreenPoint', execution, scrollback: request.scrollback }).pipe(
            Effect.flatMap((answer) =>
              Effect.map(expect('ScreenPoint', answer), ({ point }) =>
                point._tag === 'ScreenPoint' ? { ...point, bytes: answer.payload } : point,
              ),
            ),
          ),
      }),

      ...TerminalInput.of({
        input: (execution, scope, request) =>
          Effect.suspend(() => {
            const framed = outbound(request);
            if (framed === undefined) return new WireInvalid({ detail: 'an input act carries no bytes' });
            return ask(
              {
                _tag: 'Input',
                execution,
                scope,
                sequence: request.sequence,
                cause: request.cause,
                profile: request.profile,
                act: framed.act,
              },
              framed.payload,
            ).pipe(
              Effect.flatMap((answer) => expect('Input', answer)),
              Effect.map((response) => response.outcome),
            );
          }),

        openBinding: (principal) => authority({ _tag: 'OpenBinding', principal }),

        closeBinding: (binding, principal) => authority({ _tag: 'CloseBinding', binding, principal }),
      }),

      ...TerminalLanes.of({
        open: (execution, claim) =>
          ask({ _tag: 'OpenTerminalLane', claim, execution }).pipe(
            Effect.flatMap((answer) => expect('OpenTerminalLane', answer)),
            Effect.map(({ port, token, next }) => ({ port, token, next })),
          ),

        inputs: (execution) =>
          Effect.map(subscribed({ _tag: 'Inputs', execution }, limits.credits), (deliveries) =>
            deliveries.pipe(
              Stream.takeWhile((delivery) => delivery._tag !== 'Ended' || delivery.ending !== 'completed'),
              Stream.mapEffect((delivery) =>
                delivery._tag === 'Inputs'
                  ? Effect.succeed(delivery.input)
                  : Effect.fail(
                      new WireLost({
                        reason:
                          delivery._tag === 'Ended'
                            ? `the input subscription ended: ${delivery.ending}`
                            : `unexpected ${delivery._tag} on an input subscription`,
                        sent: false,
                      }),
                    ),
              ),
            ),
          ),
      }),

      ...ExecutionCustody.of({
        custody: (request, principal) =>
          ask({ _tag: 'Custody', request, principal }).pipe(
            Effect.flatMap((answer) => expect('Custody', answer)),
            Effect.map((response) => response.outcome),
          ),
      }),

      ...ExecutionEvidence.of({
        load: Effect.fnUntraced(function* (serverPid, parts) {
          const connected = yield* connect();
          const opened = yield* Effect.acquireRelease(
            reader(connected, { _tag: 'Load', serverPid, parts }, connected.limits.credits),
            (reader) => Effect.andThen(connected.unsubscribe(reader.subscription), connected.readers.close(reader.subscription)),
          );
          const readings = Stream.fromQueue(opened.queue).pipe(
            Stream.flatMap((held) =>
              Stream.concat(
                Stream.succeed(held.delivery),
                Stream.drain(
                  Stream.fromEffect(
                    Effect.gen(function* () {
                      if (held.cost > 0 && (yield* connected.readers.grant(opened.subscription, held.cost)))
                        yield* connected.credit(opened.subscription, held.cost);
                    }),
                  ),
                ),
              ),
            ),
            Stream.mapEffect((delivery) =>
              delivery._tag === 'Load'
                ? Effect.succeed(delivery.reading)
                : Effect.fail(
                    new WireLost({
                      reason:
                        delivery._tag === 'Ended'
                          ? `the load subscription ended: ${delivery.ending}`
                          : `unexpected ${delivery._tag} on a load subscription`,
                      sent: false,
                    }),
                  ),
            ),
          );
          const setInterest: LoadSubscription['setInterest'] = (interest) =>
            over(connected, { _tag: 'LoadInterest', subscription: opened.subscription, ...interest }, EMPTY_PAYLOAD).pipe(
              Effect.flatMap((answer) => expect('LoadInterest', answer)),
              Effect.flatMap((answer) =>
                answer.applied ? Effect.void : new WireUnreadable({ detail: 'the load subscription no longer stands' }),
              ),
            );
          const setParts: LoadSubscription['setParts'] = (parts) =>
            over(connected, { _tag: 'LoadParts', subscription: opened.subscription, parts }, EMPTY_PAYLOAD).pipe(
              Effect.flatMap((answer) => expect('LoadParts', answer)),
              Effect.flatMap((answer) =>
                answer.applied ? Effect.void : new WireUnreadable({ detail: 'the load subscription no longer stands' }),
              ),
            );
          return { readings, setInterest, setParts };
        }),

        foreground: (execution) =>
          ask({ _tag: 'Foreground', execution }).pipe(
            Effect.flatMap((answer) => expect('Foreground', answer)),
            Effect.map((response) => response.outcome),
            Effect.catchTag('HostRefused', (failure) =>
              failure.refusal._tag === 'UnsupportedCapability'
                ? Effect.succeed(ForegroundRefusal.make({ reason: 'unsupported', detail: failure.refusal.reason }))
                : Effect.fail(failure),
            ),
          ),

        processes: (execution) =>
          ask({ _tag: 'Processes', execution }).pipe(
            Effect.flatMap((answer) => expect('Processes', answer)),
            Effect.map((response) => response.report),
          ),

        listeners: (execution) =>
          ask({ _tag: 'Listeners', execution }).pipe(
            Effect.flatMap((answer) => expect('Listeners', answer)),
            Effect.map((response) => response.report),
          ),

        hostListeners: () =>
          ask({ _tag: 'ListenerInventory' }).pipe(
            Effect.flatMap((answer) => expect('ListenerInventory', answer)),
            Effect.map((response) => response.report),
          ),
      }),

      ...HostAuthority.of({
        take: (operation, expected) => authority({ _tag: 'TakeHost', operation, expected }),

        fence: (operation, expected) => authority({ _tag: 'FenceHost', operation, expected }),

        release: (operation, custody) => authority({ _tag: 'ReleaseHost', operation, custody }),

        grant: (operation, share) => authority({ _tag: 'Grant', operation, share }),
      }),

      ...HostLifecycle.of({
        endProcess: (target) =>
          ask({ _tag: 'EndProcess', target }).pipe(
            Effect.flatMap((answer) => expect('EndProcess', answer)),
            Effect.map((response) => response.outcome),
          ),

        endResidual: (origin, pid) =>
          ask({ _tag: 'EndResidual', origin, pid }).pipe(
            Effect.flatMap((answer) => expect('EndResidual', answer)),
            Effect.map((response) => response.outcome),
          ),

        status: () =>
          ask({ _tag: 'Status' }).pipe(
            Effect.flatMap((answer) => expect('Status', answer)),
            Effect.map((response) => response.status),
          ),

        capabilities: () => Effect.map(connect(), (session) => session.welcome.profile),

        served: () => Effect.map(connect(), (session) => session.served),

        generation: () => Effect.map(connect(), (session) => session.welcome.incarnation),

        quiesce: (operation) =>
          ask({ _tag: 'Quiesce', operation }).pipe(
            Effect.flatMap((answer) => expect('Quiesce', answer)),
            Effect.map((response) => response.outcome),
          ),

        resume: (ticket) =>
          ask({ _tag: 'Resume', ticket }).pipe(
            Effect.flatMap((answer) => expect('Resume', answer)),
            Effect.map((response) => response.outcome),
          ),

        prepare: (operation) =>
          ask({ _tag: 'Prepare', operation }).pipe(
            Effect.flatMap((answer) => expect('Prepare', answer)),
            Effect.map((response) => response.outcome),
          ),

        yield: (ticket) =>
          ask({ _tag: 'Yield', ticket }).pipe(
            Effect.flatMap((answer) => expect('Yield', answer)),
            Effect.map((response) => response.outcome),
          ),

        shutdown: (operation) =>
          ask({ _tag: 'Shutdown', operation }).pipe(
            Effect.flatMap((answer) => expect('Shutdown', answer)),
            Effect.map((response) => response.outcome),
          ),

        pace: (pace) =>
          ask({ _tag: 'Pace', pace }).pipe(
            Effect.flatMap((answer) => expect('Pace', answer)),
            Effect.map((response) => response.report),
          ),

        disown: (disowned) =>
          ask({ _tag: 'Disown', disowned }).pipe(
            Effect.flatMap((answer) => expect('Disown', answer)),
            Effect.map((response) => response.report),
          ),
      }),
    };
  };

  return { ...surface(session), awaiting: (ready: Effect.Effect<void>) => surface(() => Effect.andThen(ready, session())) };
});

export type Client = Effect.Success<ReturnType<typeof make>>;

const context = (services: Executions['Service'] & ExecutionFeed['Service'] & ExecutionRequest['Service'] & TerminalInput['Service']) =>
  Context.make(Executions, services).pipe(
    Context.add(ExecutionRequest, services),
    Context.add(ExecutionFeed, services),
    Context.add(TerminalInput, services),
  );

export const ExecutionClient = {
  make,
  context,
  layer: (input: ClientInput) =>
    Layer.effectContext(
      Effect.map(make(input), (services) =>
        context(services).pipe(
          Context.add(Commands, services),
          Context.add(ExecutionRecord, services),
          Context.add(TerminalScreen, services),
          Context.add(TerminalLanes, services),
          Context.add(ExecutionCustody, services),
          Context.add(ExecutionEvidence, services),
          Context.add(HostAuthority, services),
          Context.add(HostLifecycle, services),
        ),
      ),
    ),
};

const outbound = (request: InputRequest): { readonly act: InputFrame; readonly payload: Uint8Array } | undefined => {
  if (request.act._tag === 'Interrupt') return { act: { _tag: 'Interrupt' }, payload: EMPTY_PAYLOAD };
  if (request.act._tag === 'End') return { act: { _tag: 'End' }, payload: EMPTY_PAYLOAD };
  if (request.act._tag === 'Resize') {
    return { act: { _tag: 'Resize', geometry: request.act.geometry }, payload: EMPTY_PAYLOAD };
  }
  const bytes = request.act.bytes;
  return bytes.length === 0 ? undefined : { act: { _tag: 'Write', bytes: bytes.length }, payload: bytes };
};

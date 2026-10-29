import {
  type CommandFailure,
  type Connection,
  eventParams,
  type Params,
  type Result,
  type Session,
  SessionEnded,
} from '@runlith/cdp/session';
import { type Duration, Effect, Option, Semaphore, Stream } from 'effect';
import { type CaptureHost, type HostFailure, HostLost, HostRefused, type ProfileRecord } from '../browser/contract/service/hosts.js';
import { ProfileId } from '../browser/contract/wire/ids.js';
import { type BuildId, MANAGED } from './contract/wire/document.js';

export type Targets = {
  create(params: Params<'Target.createTarget'>): Effect.Effect<Result<'Target.createTarget'>, CommandFailure>;
  crash(target: string, service: Session, eligible: () => boolean): Effect.Effect<boolean, CommandFailure>;
};

export type Browser = { readonly connection: Connection; readonly targets: Targets; users: number; idleSince: number | null };

export const makeTargets = Effect.fnUntraced(function* (connection: Connection, threshold: Duration.Input) {
  const root = connection.root;
  const gate = yield* Semaphore.make(1);
  const keeper = yield* root.send('Target.createTarget', { url: 'about:blank', background: true });
  const targets: Targets = {
    create: (params) => gate.withPermits(1)(root.send('Target.createTarget', params)),
    crash: Effect.fn('ManagedHost.crash')(
      function* (target, service, eligible) {
        const events = yield* root.events();
        const births = yield* root.events((method) => method === 'Target.targetCreated');
        let appeared = false;
        yield* Stream.runForEach(births, () =>
          Effect.sync(() => {
            appeared = true;
          }),
        ).pipe(Effect.forkScoped);
        const { targetInfos } = yield* root.send('Target.getTargets');
        if (!eligible() || !targetInfos.some((info) => info.targetId === target)) return false;
        const watched = targetInfos.filter((info) => info.type === 'page' || info.type === 'iframe');
        const others = watched.filter((info) => info.targetId !== target && info.targetId !== keeper.targetId);
        const { current, probes } = yield* Effect.all(
          {
            current: service
              .send('Runtime.evaluate', { expression: '0', returnByValue: true })
              .pipe(Effect.result, Effect.timeoutOption(threshold)),
            probes: Effect.forEach(
              others,
              (info) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    const { sessionId } = yield* Effect.acquireRelease(
                      root.send('Target.attachToTarget', { targetId: info.targetId, flatten: true }),
                      ({ sessionId }) =>
                        root.send('Target.detachFromTarget', { sessionId }).pipe(quiet(`releasing a renderer probe of ${info.targetId}`)),
                    );
                    const session = yield* connection.attach(sessionId);
                    return yield* session.send('Runtime.evaluate', { expression: '0', returnByValue: true });
                  }),
                ).pipe(
                  Effect.result,
                  Effect.timeoutOption(threshold),
                  Effect.map((answer) => ({ info, answer })),
                ),
              { concurrency: 'unbounded' },
            ),
          },
          { concurrency: 'unbounded' },
        );
        if (Option.isSome(current) || !eligible()) {
          const reason = Option.isNone(current)
            ? 'the page state changed'
            : current.value._tag === 'Failure'
              ? current.value.failure.message
              : 'the main frame answered its fresh probe';
          yield* Effect.logDebug(`managed browser: closing target ${target} without crashing its renderer: ${reason}`);
          return false;
        }
        const uncertain = probes.filter(
          ({ answer }) => Option.isNone(answer) || answer.value._tag === 'Failure' || answer.value.success.exceptionDetails !== undefined,
        );
        const after = (yield* root.send('Target.getTargets')).targetInfos.filter((info) => info.type === 'page' || info.type === 'iframe');
        const before = new Map(watched.map((info) => [info.targetId, info.url]));
        if (appeared || uncertain.length > 0 || after.some((info) => before.get(info.targetId) !== info.url)) {
          yield* Effect.logWarning(
            `managed browser: closing target ${target} without ending its renderer: another page or frame may share it; unverified targets: ${uncertain.map(({ info, answer }) => `${info.targetId} (${info.url}): ${Option.isNone(answer) ? 'probe did not answer' : answer.value._tag === 'Failure' ? answer.value.failure.message : 'probe raised an exception'}`).join(', ') || 'targets changed during the proof'}`,
          );
          return false;
        }
        if (!eligible()) return false;
        yield* service.post('Page.crash');
        return yield* events.pipe(
          Stream.filter((event) => event.method === 'Target.targetCrashed' || event.method === 'Target.targetDestroyed'),
          Stream.mapEffect((event) =>
            Effect.map(eventParams('Target.targetCrashed', event), (params) => ({
              ...params,
              crashed: event.method === 'Target.targetCrashed',
            })),
          ),
          Stream.filter((event) => event.targetId === target),
          Stream.runHead,
          Effect.flatMap((event) =>
            Option.isNone(event)
              ? Effect.fail(new SessionEnded({ message: 'the browser ended before its renderer', end: 'lost', pending: true }))
              : Effect.succeed(event.value.crashed),
          ),
        );
      },
      Effect.scoped,
      gate.withPermits(1),
    ),
  };
  return targets;
});

const CAPTURE = ProfileId.make('managed-capture');

export const lost = (failure: CommandFailure): HostLost =>
  new HostLost({
    message: failure._tag === 'CommandRefused' ? `${failure.method} was refused: ${failure.message}` : failure.message,
    pending: failure._tag === 'SessionEnded' && failure.pending,
  });

export const quiet =
  (where: string) =>
  <A, R>(effect: Effect.Effect<A, CommandFailure, R>): Effect.Effect<A | void, never, R> =>
    effect.pipe(
      Effect.catchTags({
        SessionEnded: () => Effect.void,
        CommandRefused: (refusal) => Effect.logDebug(`managed browser: ${where} was refused: ${refusal.message}`),
        PayloadUnreadable: (unreadable) => Effect.logWarning(`managed browser: ${where} was unreadable: ${unreadable.message}`),
        WorkerUnavailable: (gone) => Effect.logWarning(`managed browser: ${where} was not read: ${gone.message}`),
      }),
    );

export const hiddenTarget = Effect.fnUntraced(function* (browser: Browser) {
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      browser.users += 1;
    }),
    () =>
      Effect.sync(() => {
        browser.users -= 1;
        browser.idleSince = null;
      }),
  );
  const root = browser.connection.root;
  const { targetId } = yield* Effect.acquireRelease(
    browser.targets.create({ url: 'about:blank', hidden: true }).pipe(Effect.mapError(lost)),
    (created) =>
      root.send('Target.closeTarget', { targetId: created.targetId }).pipe(quiet(`closing the hidden target ${created.targetId}`)),
  );
  const { sessionId } = yield* root.send('Target.attachToTarget', { targetId, flatten: true }).pipe(Effect.mapError(lost));
  return yield* browser.connection.attach(sessionId);
});

const capturing = (build: BuildId): ProfileRecord => ({
  id: CAPTURE,
  name: 'Capture',
  adapter: MANAGED,
  document: { build },
  console: 'auto',
  removal: null,
  createdAt: new Date(0),
});

export const captureHost = (ensure: (record: ProfileRecord) => Effect.Effect<Browser, HostFailure>): CaptureHost => {
  const browser = ensure(capturing('chrome-for-testing')).pipe(
    Effect.catchTag('HostRefused', (first) =>
      ensure(capturing('installed-chrome')).pipe(
        Effect.catchTag('HostRefused', (second) =>
          Effect.fail(new HostRefused({ message: `${first.message}; ${second.message}`, unblock: [...first.unblock, ...second.unblock] })),
        ),
      ),
    ),
  );
  return {
    target: Effect.fn('ManagedHost.captureTarget')(function* (canvas) {
      const session = yield* hiddenTarget(yield* browser);
      yield* session
        .send('Emulation.setDeviceMetricsOverride', {
          width: canvas.width,
          height: canvas.height,
          deviceScaleFactor: canvas.scale,
          mobile: false,
        })
        .pipe(Effect.mapError(lost));
      return session;
    }),
  };
};

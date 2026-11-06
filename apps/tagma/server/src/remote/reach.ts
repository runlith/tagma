import { hostname } from 'node:os';
import { Cause, Duration, Effect, Exit, FiberHandle, Queue, Schedule, Scope, Stream } from 'effect';
import { Settings } from '../settings/contract/service/values.js';
import type { Access } from './contract/service/access.js';
import { Exposure, type ExposureStep, type Listener, WithdrawalRefused } from './contract/service/exposure.js';
import type { TerminalSite } from './contract/service/sites.js';
import type { AccessState } from './contract/wire/access.js';
import { remoteEnabled } from './keys.js';
import { Ledger } from './store/ledger.js';
import { makeTerminalSite } from './terminalSite.js';

const RETRY_PAUSE = Duration.seconds(5);

const WITHDRAWAL_RETRY = Schedule.min([Schedule.exponential('2 seconds'), Schedule.spaced('1 minute')]);

const OFF: AccessState = { _tag: 'off' };

const SETTING_UP: AccessState = { _tag: 'setting-up' };

export type Reach = Access['Service'] & {
  readonly origin: string | null;
  readonly ready: boolean;
  readonly name: string;
  readonly terminal: TerminalSite['Service'];
};

export const makeReach = Effect.gen(function* () {
  const settings = yield* Settings;
  const exposure = yield* Exposure;
  const ledger = yield* Ledger;
  const nudges = yield* Queue.sliding<void>(1);
  const host = hostname();
  let state: AccessState = OFF;
  let sandbox: AccessState = OFF;
  let enabled = false;
  let machine: string | null = null;
  let settled: string | null = null;

  const ready = () => state._tag === 'ready';

  const parentOrigin = () => (enabled && (state._tag === 'certificate' || ready()) ? settled : null);

  const terminal = yield* makeTerminalSite({ ready: () => parentOrigin() !== null });

  const machineName = () => machine ?? host;

  const adopt = Effect.fnUntraced(function* (step: ExposureStep) {
    if (step._tag === 'listening') {
      sandbox = step.sandbox;
      return;
    }
    state = step._tag === 'ready' ? { _tag: 'ready', origin: step.origin } : step;
    if (step._tag === 'ready') {
      sandbox = step.sandbox;
      if (step.machine !== null) machine = step.machine;
    }
    const origin = step._tag === 'certificate' || step._tag === 'ready' ? step.origin : null;
    if (origin === null || origin === settled) return;
    yield* ledger.settle(origin);
    settled = origin;
  });

  const exposed = Effect.fnUntraced(function* (listener: Listener) {
    state = SETTING_UP;
    sandbox = SETTING_UP;
    yield* Effect.addFinalizer(() => terminal.forget);
    const scope = yield* Effect.scope;
    let opened = false;
    yield* Stream.runForEach(exposure.expose(listener.port, settled), (step) =>
      Effect.gen(function* () {
        yield* adopt(step);
        if (step._tag !== 'listening' || opened) return;
        yield* Effect.acquireRelease(listener.open.pipe(Effect.withSpan('Access.openListener')), () =>
          listener.close.pipe(Effect.withSpan('Access.closeListener')),
        ).pipe(Scope.provide(scope));
        opened = true;
      }),
    ).pipe(
      Effect.withSpan('Access.expose'),
      Effect.catchTag('ListenerRefused', (refused) =>
        Effect.sync(() => {
          state = { _tag: 'blocked', problem: 'listener-failed', detail: refused.reason, command: null, link: null };
        }),
      ),
    );
    if (ready()) return yield* Effect.never;
  }, Effect.scoped);

  const attempt = Effect.fnUntraced(function* (listener: Listener) {
    const ended = yield* Effect.exit(exposed(listener));
    if (Exit.isSuccess(ended)) return;
    if (Cause.hasInterruptsOnly(ended.cause)) return yield* Effect.interrupt;
    const stopped = Cause.pretty(ended.cause);
    state = { _tag: 'blocked', problem: 'refused', detail: `the remote door stopped: ${stopped}`, command: null, link: null };
    yield* Effect.logError('the remote door stopped', stopped);
  });

  const pause = Effect.andThen(Effect.sleep(RETRY_PAUSE), Queue.take(nudges));

  const open = Effect.fnUntraced(function* (listener: Listener) {
    enabled = true;
    return yield* Effect.forever(Effect.andThen(attempt(listener), pause));
  });

  const shut = Effect.fnUntraced(function* (handle: FiberHandle.FiberHandle<void, WithdrawalRefused>, port: number) {
    enabled = false;
    state = OFF;
    sandbox = OFF;
    if (settled === null) return;
    const pointed = Effect.map(
      Effect.mapError(
        ledger.terminal,
        (failure) => new WithdrawalRefused({ reason: `the port of the terminal site could not be read: ${failure.message}` }),
      ),
      (site): readonly number[] => (site === null ? [] : [site]),
    );
    const withdrawn = Effect.flatMap(pointed, (sites) => exposure.withdraw(port, sites)).pipe(
      Effect.tapError((refused) =>
        Effect.logWarning(`the Tailscale Serve mapping to port ${port} stands; withdrawing it again`, refused.reason),
      ),
      Effect.retry(WITHDRAWAL_RETRY),
    );
    yield* FiberHandle.run(handle, withdrawn);
  });

  const reach: Reach = {
    get origin() {
      return settled;
    },
    get ready() {
      return ready();
    },
    get name() {
      return machineName();
    },
    get parentOrigin() {
      return parentOrigin();
    },
    get sandboxOrigin() {
      return parentOrigin() !== null && (sandbox._tag === 'certificate' || sandbox._tag === 'ready') ? sandbox.origin : null;
    },
    read: Effect.sync(() => {
      if (state._tag === 'blocked') Queue.offerUnsafe(nudges, undefined);
      return { enabled, state, sandbox, machine: machineName() };
    }),
    serve: Effect.fnUntraced(function* (listener) {
      settled = yield* ledger.origin;
      const handle = yield* FiberHandle.make<void, WithdrawalRefused>();
      const switched = yield* settings.changes(remoteEnabled);
      yield* Stream.runForEach(Stream.changes(switched), (on) =>
        Effect.andThen(FiberHandle.clear(handle), on ? FiberHandle.run(handle, open(listener)) : shut(handle, listener.port)),
      );
      return yield* Effect.never;
    }, Effect.scoped),
    terminal: terminal.site,
  };
  return reach;
});

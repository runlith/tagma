import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, FileSystem, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { WireUnavailable } from '@runlith/executions/Executions';
import { HostRegistration, RegistrationMissing } from '@runlith/executions/HostRegistration';
import { Digest } from '@runlith/executions/protocol/artifact';
import { InstallationId } from '@runlith/executions/protocol/execution';
import type { Registration } from '@runlith/executions/protocol/registration';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { HostPlacement, YieldAsk } from '../contract/service/host.js';
import { awaitLogic } from './arrival.js';
import type { StateClaim } from './boot.js';

const STATE = '/state';
const OURS = Digest.make(`sha256:${'a'.repeat(64)}`);
const BEFORE = Digest.make(`sha256:${'b'.repeat(64)}`);
const placed: HostPlacement = { _tag: 'Placed', digest: OURS, bundle: true, detail: 'placed' };
const absent = new WireUnavailable({ kind: 'absent', reason: 'nothing listens', sent: false });

const registered = (digest: Digest, pid: number): Registration => ({
  version: 1,
  state: STATE,
  installation: InstallationId.make('arrival'),
  protocol: 'executions/1',
  endpoint: { transport: 'unix', path: `${STATE}/host.sock` },
  credentials: { custodian: `${STATE}/custodian`, recovery: `${STATE}/recovery` },
  artifact: { identity: { digest, build: digest === OURS ? 'ours' : 'before' }, protocol: 'executions/1', wire: 1 },
  logic: { pid, birth: `${pid}:0` },
});

const statusAt = (phase: RuntimeStatus['phase']): RuntimeStatus => ({
  installation: InstallationId.make('arrival'),
  incarnation: 1,
  phase,
  holder: { _tag: 'Standing' },
  custody: { revision: 0, epoch: 0 },
  executions: 0,
  memory: {
    granted: { share: 0.25, machineBytes: 8_589_934_592, grantBytes: 2_147_483_648 },
    reserved: 0,
    retained: 0,
    executions: 0,
    ceiling: 64,
  },
});

const unused = Effect.die('not reached by the arrival');

const world = Effect.fnUntraced(function* (told: YieldAsk) {
  const registration = yield* Ref.make<Registration | undefined>(registered(BEFORE, 10));
  const answer = yield* Ref.make<RuntimeStatus['phase'] | undefined>(undefined);
  const claim = yield* Ref.make<StateClaim>({ _tag: 'Held', holders: [1] });
  const refusal = yield* Ref.make<string | undefined>(undefined);
  const watching = yield* Deferred.make<void>();
  const noop = FileSystem.makeNoop({});
  const watch = {
    files: FileSystem.makeNoop({
      readFileString: (path) =>
        Effect.flatMap(Ref.get(refusal), (said) => (said === undefined ? noop.readFileString(path) : Effect.succeed(said))),
    }),
    registrations: HostRegistration.of({
      read: () =>
        Effect.flatMap(Ref.get(registration), (standing) =>
          standing === undefined ? Effect.fail(new RegistrationMissing({ state: STATE })) : Effect.succeed(standing),
        ),
      publish: () => unused,
      record: () => unused,
      withdraw: () => unused,
    }),
    status: Effect.flatMap(Ref.get(answer), (phase) => (phase === undefined ? Effect.fail(absent) : Effect.succeed(statusAt(phase)))),
    claim: Effect.andThen(Deferred.succeed(watching, undefined), Ref.get(claim)),
    ask: { ask: () => Effect.succeed(told) },
    state: STATE,
  };
  const arrive = Effect.tap(Effect.forkChild(awaitLogic(watch, placed)), () => Deferred.await(watching));
  return { arrive, registration, answer, claim, refusal };
});

it.effect('a logic of this build that comes up ten minutes after the last one left is waited for and ends the wait', () =>
  Effect.gen(function* () {
    const { arrive, registration, answer } = yield* world({ _tag: 'Gone' });
    const arriving = yield* arrive;
    yield* TestClock.adjust('10 minutes');
    yield* Ref.set(registration, registered(OURS, 11));
    yield* Ref.set(answer, 'open');
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(arriving)).toEqual({ _tag: 'Arrived' });
  }),
);

it.effect('a holder that lets go of the state ends the wait, so the server raises its own', () =>
  Effect.gen(function* () {
    const { arrive, claim } = yield* world({ _tag: 'Gone' });
    const arriving = yield* arrive;
    yield* TestClock.adjust('5 minutes');
    yield* Ref.set(claim, { _tag: 'Free' });
    yield* TestClock.adjust('1 second');
    expect(yield* Fiber.join(arriving)).toEqual({ _tag: 'Unheld' });
  }),
);

it.effect('a standing logic of another build that refuses the candidate ends the wait with its own words', () =>
  Effect.gen(function* () {
    const { arrive, refusal } = yield* world({ _tag: 'Asked' });
    const arriving = yield* arrive;
    yield* TestClock.adjust('5 minutes');
    yield* Ref.set(refusal, 'the store went past this build\n');
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(arriving)).toEqual({ _tag: 'Refused', detail: 'the store went past this build' });
  }),
);

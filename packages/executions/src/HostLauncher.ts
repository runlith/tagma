import { spawn } from 'node:child_process';
import { Context, Effect, FileSystem, type Schedule, type Scope } from 'effect';

import { ExecutionClient } from './ExecutionClient';
import type { Unavailability } from './Executions';
import type { HostAddress } from './hostAddress';
import { HostRegistration } from './HostRegistration';
import { EndpointConnection } from './EndpointConnection';
import type { Role } from './protocol/registration';
import type { RuntimeStatus } from './protocol/runtime';
import type { WireLimits } from './protocol/wire';
import type { SessionBudget } from './WireSession';

export type HostState =
  | { readonly _tag: 'Absent'; readonly state: string }
  | { readonly _tag: 'Invalid'; readonly kind: Unavailability; readonly reason: string }
  | { readonly _tag: 'Unavailable'; readonly reason: string }
  | { readonly _tag: 'Rejected'; readonly reason: string }
  | { readonly _tag: 'Standing'; readonly status: RuntimeStatus };

export type Launch =
  | { readonly _tag: 'Adopted'; readonly status: RuntimeStatus }
  | { readonly _tag: 'Started'; readonly status: RuntimeStatus }
  | { readonly _tag: 'Lost'; readonly exit: number | undefined; readonly detail: string }
  | { readonly _tag: 'Refused'; readonly kind: Unavailability; readonly reason: string };

export type HostArtifact = {
  readonly program: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
};

export type HostLauncher = {
  readonly standing: () => Effect.Effect<HostState>;
  readonly launch: (artifact: HostArtifact, readiness: Schedule.Schedule<unknown, unknown>) => Effect.Effect<Launch, never, Scope.Scope>;
};

export const HostLauncher = {
  make: Effect.fnUntraced(function* (address: HostAddress, role: Role, limits: WireLimits, budget: SessionBudget = {}) {
    const files = yield* FileSystem.FileSystem;
    const registrations = yield* HostRegistration;
    const connection = yield* EndpointConnection;
    const owners = Context.make(FileSystem.FileSystem, files).pipe(
      Context.add(HostRegistration, registrations),
      Context.add(EndpointConnection, connection),
    );
    return {
      standing: () => Effect.provide(ask(address, role, limits, budget), owners),
      launch: (artifact: HostArtifact, readiness: Schedule.Schedule<unknown, unknown>) =>
        Effect.provide(started(address, role, limits, budget, artifact, readiness), owners),
    } satisfies HostLauncher;
  }),
};

const ask = Effect.fn('HostLauncher.standing')(
  function* (address: HostAddress, role: Role, limits: WireLimits, budget: SessionBudget) {
    const executions = yield* ExecutionClient.make({ address, role, limits, budget });
    return yield* executions.status();
  },
  Effect.scoped,
  (effect, address) =>
    Effect.match(effect, {
      onFailure: (failure): HostState =>
        failure._tag === 'WireFailed'
          ? { _tag: 'Rejected', reason: `${failure.fault.kind}: ${failure.fault.detail}` }
          : failure._tag === 'WireInvalid' || failure._tag === 'WireUnreadable'
            ? { _tag: 'Rejected', reason: failure.detail }
            : failure._tag === 'HostRefused'
              ? { _tag: 'Rejected', reason: failure.refusal._tag }
              : failure._tag === 'WireLost'
                ? { _tag: 'Unavailable', reason: failure.reason }
                : failure.kind === 'absent'
                  ? { _tag: 'Absent', state: address.state }
                  : failure.kind === 'unreachable'
                    ? { _tag: 'Unavailable', reason: failure.reason }
                    : { _tag: 'Invalid', kind: failure.kind, reason: failure.reason },
      onSuccess: (status): HostState => ({ _tag: 'Standing', status }),
    }),
);

const started = Effect.fn('HostLauncher.launch')(function* (
  address: HostAddress,
  role: Role,
  limits: WireLimits,
  budget: SessionBudget,
  artifact: HostArtifact,
  readiness: Schedule.Schedule<unknown, unknown>,
) {
  const before = yield* ask(address, role, limits, budget);
  if (before._tag === 'Standing') return { _tag: 'Adopted', status: before.status } satisfies Launch;
  if (before._tag === 'Invalid') {
    return { _tag: 'Refused', kind: before.kind, reason: before.reason } satisfies Launch;
  }
  if (before._tag === 'Rejected') {
    return {
      _tag: 'Refused',
      kind: 'credential',
      reason: `a host answered at this address and did not admit this client: ${before.reason}`,
    } satisfies Launch;
  }

  const child = yield* Effect.sync(() => {
    try {
      const spawned = spawn(artifact.program, [...artifact.args], {
        cwd: artifact.cwd,
        env: { ...artifact.environment },
        stdio: 'ignore',
        detached: true,
      });
      spawned.unref();
      return spawned;
    } catch {
      return undefined;
    }
  });
  if (child === undefined) {
    return { _tag: 'Refused', kind: 'invalid', reason: 'the host artifact could not be run' } satisfies Launch;
  }

  const answered = Effect.retry(
    Effect.flatMap(ask(address, role, limits, budget), (found) =>
      found._tag === 'Standing' ? Effect.succeed(found.status) : Effect.fail(found),
    ),
    readiness,
  );
  const ended = Effect.callback<number | undefined>((resume) => {
    const exited = (code: number | null) => resume(Effect.succeed(code ?? undefined));
    const failed = () => resume(Effect.succeed(undefined));
    child.once('exit', exited);
    child.once('error', failed);
    return Effect.sync(() => {
      child.removeListener('exit', exited);
      child.removeListener('error', failed);
    });
  });

  return yield* Effect.raceFirst(
    Effect.map(answered, (status): Launch => ({ _tag: 'Started', status })),
    Effect.map(ended, (exit): Launch => ({
      _tag: 'Lost',
      exit,
      detail: 'the host process ended before it answered',
    })),
  ).pipe(
    Effect.catch((found: HostState) =>
      Effect.succeed({
        _tag: 'Lost',
        exit: undefined,
        detail: found._tag === 'Absent' ? 'the host published no registration' : `the host did not answer: ${found._tag}`,
      } satisfies Launch),
    ),
  );
});

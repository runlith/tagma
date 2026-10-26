import { endpointConnection } from '@runlith/executions/posix/endpoint';
import type { EndpointConnection } from '@runlith/executions/EndpointConnection';
import { Effect, FileSystem, Path, type PlatformError } from 'effect';
import type { ExecutionsFailure, Unavailability } from '@runlith/executions/Executions';
import { hostAddress, type HostAddressInvalid } from '@runlith/executions/hostAddress';
import { HostRegistration, type RegistrationFailed, type RegistrationReadFailure } from '@runlith/executions/HostRegistration';
import { recoveryClient, type RecoveryClient } from '@runlith/executions/RecoveryClient';
import {
  ExecutionId,
  type ExecutionRef,
  type InstallationId,
  HostRequestKey,
  type HostRequestRef,
} from '@runlith/executions/protocol/execution';
import type { Registration } from '@runlith/executions/protocol/registration';
import { executionWireLimits } from '../../host/policy.js';
import { executionHandshakeMs } from '../../contract/wire/terminalBehavior.js';
import { refuse, print } from '../../../platform/cli/verb.js';
import { EXECUTIONS_HOME } from '../../contract/wire/home.js';

export type RefusalDescriptor = {
  readonly code: string;
  readonly reason: string;
  readonly unblock: ReadonlyArray<string>;
};

export const refuseInput = (refusal: RefusalDescriptor): never => refuse(refusal.code, refusal.reason, [...refusal.unblock]);

export const refuseEffect = (refusal: RefusalDescriptor): Effect.Effect<never> => Effect.sync(() => refuseInput(refusal));

export const nothingInstalled = 'nothing is installed here';

export type ResolvedHost = {
  readonly state: string;
  readonly registration: Registration;
};

export type HostCandidate = ResolvedHost & {
  readonly environment: string;
};

export type HostSearch =
  | { readonly _tag: 'Found'; readonly host: ResolvedHost }
  | { readonly _tag: 'Several'; readonly environments: ReadonlyArray<string> }
  | { readonly _tag: 'None' };

const pickHostSearch = (found: ReadonlyArray<HostCandidate>): HostSearch => {
  const [only, second] = found;
  if (only === undefined || second !== undefined) {
    return found.length === 0 ? { _tag: 'None' } : { _tag: 'Several', environments: found.map((candidate) => candidate.environment) };
  }
  return { _tag: 'Found', host: { state: only.state, registration: only.registration } };
};

export type ResolveInput = {
  readonly anchor: string;
  readonly environment?: string | undefined;
  readonly state?: string | undefined;
};

const discoverHosts = Effect.fnUntraced(function* (
  anchor: string,
): Effect.fn.Return<
  Array<HostCandidate>,
  RegistrationFailed | PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path | HostRegistration | EndpointConnection
> {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const registrations = yield* HostRegistration;
  const root = path.join(anchor, EXECUTIONS_HOME);
  const entries = yield* files
    .readDirectory(root)
    .pipe(
      Effect.catchTag('PlatformError', (error) =>
        error.reason._tag === 'NotFound' ? Effect.succeed([] as Array<string>) : Effect.fail(error),
      ),
    );
  const readings = yield* Effect.forEach(entries, (entry) =>
    registrations.read(path.join(root, entry)).pipe(
      Effect.catchTags({
        RegistrationMissing: () => Effect.succeed(undefined),
        RegistrationInvalid: () => Effect.succeed(undefined),
      }),
      Effect.map((standing): HostCandidate | undefined =>
        standing === undefined ? undefined : { environment: entry, state: standing.state, registration: standing },
      ),
    ),
  );
  const found: Array<HostCandidate> = [];
  for (const reading of readings) if (reading !== undefined) found.push(reading);
  found.sort((a, b) => (a.environment < b.environment ? -1 : a.environment > b.environment ? 1 : 0));
  return found;
});

export const resolveExecutionState = Effect.fnUntraced(function* (
  input: ResolveInput,
): Effect.fn.Return<
  HostSearch,
  RegistrationReadFailure | PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path | HostRegistration | EndpointConnection
> {
  const path = yield* Path.Path;
  const registrations = yield* HostRegistration;
  if (input.state !== undefined) {
    const registration = yield* registrations.read(input.state);
    return { _tag: 'Found', host: { state: registration.state, registration } };
  }
  if (input.environment !== undefined) {
    const registration = yield* registrations.read(path.join(input.anchor, EXECUTIONS_HOME, input.environment));
    return { _tag: 'Found', host: { state: registration.state, registration } };
  }
  return pickHostSearch(yield* discoverHosts(input.anchor));
});

export const unavailabilityRefusal = (kind: Unavailability, reason: string): RefusalDescriptor => {
  switch (kind) {
    case 'absent':
      return {
        code: 'host-absent',
        reason: `${nothingInstalled} — ${reason}`,
        unblock: ['run this at the installation, or name its host state directory explicitly'],
      };
    case 'invalid':
      return {
        code: 'host-invalid',
        reason: `the host registration cannot be acted on: ${reason}`,
        unblock: ['the registration stands and could not be read or decoded — nothing here clears or replaces it'],
      };
    case 'mismatched':
      return {
        code: 'host-mismatched',
        reason: `the host registration names another place: ${reason}`,
        unblock: ['address the directory the registration names, or the installation that published it'],
      };
    case 'unreachable':
      return {
        code: 'host-unreachable',
        reason: `the host stands registered but did not answer: ${reason}`,
        unblock: ['the owner may still be alive — retry, and never signal a lookalike by hand'],
      };
    case 'credential':
      return {
        code: 'host-credential',
        reason: `this caller holds no key for the host: ${reason}`,
        unblock: ['run as the user that installed this host'],
      };
  }
};

export const executionsRefusal = (failure: ExecutionsFailure): RefusalDescriptor => {
  switch (failure._tag) {
    case 'WireLost':
      return {
        code: 'wire-closed',
        reason: `the connection ended before the host answered: ${failure.reason} (sent: ${failure.sent ? 'yes' : 'no'})`,
        unblock: [
          'read a lost mutation back by its key: `tagma execution-host operation <name>`',
          're-run a lost stop, shutdown or fencing with the identical command — the key resumes it',
        ],
      };
    case 'WireInvalid':
    case 'WireUnreadable':
      return {
        code: 'wire-protocol',
        reason: failure.detail,
        unblock: [
          failure._tag === 'WireInvalid'
            ? 'the client could not frame this request — report the detail above'
            : 'the host spoke a frame this client will not read — report the detail above',
        ],
      };
    case 'WireFailed':
      return {
        code: 'wire-faulted',
        reason: `${failure.fault.kind}: ${failure.fault.detail}`,
        unblock: ['the host refused the frame — report the fault above'],
      };
    case 'WireUnavailable':
      return unavailabilityRefusal(failure.kind, failure.reason);
    case 'HostRefused':
      return {
        code: 'host-refused',
        reason: `${failure.refusal._tag}: ${failure.refusal.reason}`,
        unblock: ['the host decided against this act — its refusal above names the rule'],
      };
  }
};

const resolveRefusal = (failure: RegistrationReadFailure | PlatformError.PlatformError): RefusalDescriptor => {
  switch (failure._tag) {
    case 'RegistrationMissing':
      return unavailabilityRefusal('absent', `no registration stands in ${failure.state}`);
    case 'RegistrationInvalid':
      return failure.reason === 'mismatch'
        ? unavailabilityRefusal('mismatched', `the registration names ${failure.named}`)
        : unavailabilityRefusal('invalid', failure.detail);
    case 'RegistrationFailed':
      return unavailabilityRefusal('invalid', `${failure.act}: ${failure.detail}`);
    case 'PlatformError':
      return {
        code: 'state-unreadable',
        reason: `the installation state could not be read: ${failure.message}`,
        unblock: ['name the host state directory explicitly'],
      };
  }
};

export const severalRefusal = (environments: ReadonlyArray<string>): RefusalDescriptor => ({
  code: 'several-execution-hosts',
  reason: `several execution hosts are installed here: ${environments.join(', ')} — re-run with --environment <id> naming one`,
  unblock: environments.map((environment) => `address the host named ${environment}`),
});

export const requireSingleHost = (input: ResolveInput, json: boolean) =>
  resolveExecutionState(input).pipe(
    Effect.provide(HostRegistration.layer),
    Effect.provide(endpointConnection),
    Effect.mapError((failure) => refuseInput(resolveRefusal(failure))),
    Effect.flatMap((search) => {
      switch (search._tag) {
        case 'Several':
          return refuseEffect(severalRefusal(search.environments));
        case 'None':
          return Effect.as(print(json ? { installed: false } : nothingInstalled, json), undefined);
        case 'Found':
          return Effect.succeed(search.host);
      }
    }),
  );

export const runRecovery = <A>(
  host: ResolvedHost,
  use: (recovery: RecoveryClient['Service']) => Effect.Effect<A, ExecutionsFailure>,
): Effect.Effect<A, ExecutionsFailure | HostAddressInvalid, FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function* () {
      const address = yield* hostAddress(host.state, host.registration.installation);
      const recovery = yield* recoveryClient(address, executionWireLimits, { handshakeMs: executionHandshakeMs });
      return yield* use(recovery);
    }).pipe(Effect.provide(HostRegistration.layer), Effect.provide(endpointConnection)),
  );

export const settleHostCall = <A, R>(self: Effect.Effect<A, ExecutionsFailure | HostAddressInvalid, R>): Effect.Effect<A, never, R> =>
  Effect.mapError(self, (failure) =>
    failure._tag === 'HostAddressInvalid'
      ? refuseInput({
          code: 'state-invalid',
          reason: failure.detail,
          unblock: ['name the absolute directory holding this installation’s host registration'],
        })
      : refuseInput(executionsRefusal(failure)),
  );

export const executionRefInput = (installation: InstallationId, text: string): Effect.Effect<ExecutionRef, RefusalDescriptor> => {
  const [execution, incarnation, rest] = text.split('/');
  const at = incarnation === undefined ? Number.NaN : Number(incarnation);
  if (execution === undefined || execution.length === 0 || !Number.isInteger(at) || at < 0 || rest !== undefined) {
    return Effect.fail({
      code: 'execution-ref',
      reason: `an execution is named <execution-id>/<incarnation>, not ${JSON.stringify(text)}`,
      unblock: ['name the incarnation the execution was answered at — an id alone addresses nothing'],
    });
  }
  return Effect.succeed({ installation, execution: ExecutionId.make(execution), incarnation: at });
};

export const operationRefInput = (installation: InstallationId, name: string): Effect.Effect<HostRequestRef, RefusalDescriptor> => {
  if (name.length === 0) {
    return Effect.fail({
      code: 'operation-ref',
      reason: 'an operation is named by its key alone, and the key is empty',
      unblock: ['the installation comes from the registration — spell only the operation name'],
    });
  }
  return Effect.succeed({ installation, operation: HostRequestKey.make(name) });
};

export const revisionInput = (value: number): Effect.Effect<number, RefusalDescriptor> =>
  Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? Effect.succeed(value)
    : Effect.fail({
        code: 'custody-revision',
        reason: `a custody revision is a whole number, not ${value}`,
        unblock: ['read it off `tagma execution-host status` — fencing decides over the revision standing there'],
      });

export const limitInput = (value: number): Effect.Effect<number, RefusalDescriptor> =>
  Number.isInteger(value) && value > 0
    ? Effect.succeed(value)
    : Effect.fail({
        code: 'list-limit',
        reason: `a page holds a whole number of rows above zero, not ${value}`,
        unblock: ['use the host’s own page limit instead of an explicit one'],
      });

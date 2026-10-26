import type { EndpointConnection } from '@runlith/executions/EndpointConnection';
import { Context, Effect, FileSystem, Ref, type Scope } from 'effect';
import { ExecutionClient, type SessionOpened, type SessionWelcome } from '@runlith/executions/ExecutionClient';
import { Commands } from '@runlith/executions/Commands';
import { Executions } from '@runlith/executions/Executions';
import { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import { HostLifecycle } from '@runlith/executions/HostLifecycle';
import { TerminalInput } from '@runlith/executions/TerminalInput';
import { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { HostAddress } from '@runlith/executions/hostAddress';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import { installationAnchor } from '../../installation/paths.js';
import { executionControlRequests, executionWireLimits } from './policy.js';

export const executionStates = (storePath: string): string => `${installationAnchor(storePath)}/executions`;

export const executionState = (storePath: string, environmentId: string): string => `${executionStates(storePath)}/${environmentId}`;

export type HostExecutions = Executions['Service'] &
  Commands['Service'] &
  ExecutionRequest['Service'] &
  ExecutionRecord['Service'] &
  ExecutionFeed['Service'] &
  TerminalScreen['Service'] &
  TerminalInput['Service'] &
  ExecutionCustody['Service'] &
  ExecutionEvidence['Service'] &
  HostLifecycle['Service'];

export type HostPort = HostExecutions & HostAuthority['Service'];

export class HostConnection {
  constructor(
    readonly address: HostAddress,
    readonly port: HostPort,
    readonly welcome: Ref.Ref<SessionWelcome | undefined> = Ref.makeUnsafe<SessionWelcome | undefined>(undefined),
    readonly opened: Ref.Ref<SessionOpened | undefined> = Ref.makeUnsafe<SessionOpened | undefined>(undefined),
    readonly direct: HostPort = port,
  ) {}

  get installation(): InstallationId {
    return this.address.installation;
  }
}

export const hostServices = (port: HostExecutions) =>
  Context.make(Executions, port).pipe(
    Context.add(Commands, port),
    Context.add(ExecutionCustody, port),
    Context.add(ExecutionEvidence, port),
    Context.add(ExecutionFeed, port),
    Context.add(ExecutionRecord, port),
    Context.add(ExecutionRequest, port),
    Context.add(HostLifecycle, port),
    Context.add(TerminalInput, port),
    Context.add(TerminalScreen, port),
  );

export const executionHost = Effect.fnUntraced(function* (
  address: HostAddress,
  admitted?: Effect.Effect<void>,
): Effect.fn.Return<HostConnection, never, FileSystem.FileSystem | HostRegistration | EndpointConnection | Scope.Scope> {
  const welcome = yield* Ref.make<SessionWelcome | undefined>(undefined);
  const opened = yield* Ref.make<SessionOpened | undefined>(undefined);
  const client = yield* ExecutionClient.make({
    address,
    role: 'custodian',
    limits: executionWireLimits,
    budget: { controlRequests: executionControlRequests },
    opened: (welcomed, take) =>
      Effect.andThen(
        Ref.set(welcome, welcomed),
        Effect.flatMap(Ref.get(opened), (hook) => (hook === undefined ? Effect.void : hook(welcomed, take))),
      ),
  });
  return new HostConnection(address, admitted === undefined ? client : client.awaiting(admitted), welcome, opened, client);
});

import { Effect, Scope, Stream } from 'effect';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions, ExecutionsFailure } from '@runlith/executions/Executions';
import type { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { HostRefused } from '@runlith/executions/Executions';
import type { ExecutionRef, ExecutionState, HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest, NativeProcess, StartAnswer } from '@runlith/executions/protocol/launch';
import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { EnvironmentKind } from '../../workspace/contract/wire/environments.js';
import { TerminalRefused, TerminalUnavailable, hostRefusalOf } from '../contract/wire/refusals.js';
import { principalOf } from './principals.js';
import { type TerminalActor } from '../contract/wire/terminals.js';
import type { ResolvedExecutionTarget } from '../contract/wire/targets.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { HostConnection } from '../host/connection.js';
import { targetIdentity, targetKeyOf } from './subjectPolicy.js';
import { TERMINAL_PERMISSION_REVISION } from '../contract/service/subjectPolicy.js';
import type { CommandLaunch } from '../contract/service/commands.js';
import type { Discharge } from '../contract/service/discharge.js';
import type { ExecutionProcessEvidence } from '../contract/service/records.js';
import type { Terminals, TerminalFailure, TerminalStartReceipt } from '../contract/service/terminals.js';
import type { TerminalWriting } from '../contract/service/writing.js';

export type ExecutionCaller = {
  readonly actor: TerminalActor;
  readonly projectId: number;
  readonly runId?: string;
  readonly kind: EnvironmentKind;
  readonly root: string;
};

export type ExecutionPort = Executions['Service'] &
  Commands['Service'] &
  ExecutionRequest['Service'] &
  ExecutionRecord['Service'] &
  ExecutionFeed['Service'] &
  TerminalScreen['Service'] &
  TerminalInput['Service'] &
  ExecutionCustody['Service'] &
  ExecutionEvidence['Service'] &
  HostAuthority['Service'] &
  HostLifecycle['Service'];

const refusedAs = (tag: (typeof hostRefusalOf)[TerminalRefused['reason']], detail: string): HostRefused =>
  new HostRefused({ refusal: { _tag: tag, reason: detail } });

const refused = (detail: string): HostRefused => refusedAs('Unauthorized', detail);

const carried = <A>(work: Effect.Effect<A, TerminalFailure>): Effect.Effect<A, ExecutionsFailure> =>
  Effect.catch(work, (failure) =>
    failure instanceof TerminalRefused
      ? Effect.fail(refusedAs(hostRefusalOf[failure.reason], failure.message))
      : failure instanceof TerminalUnavailable
        ? Effect.fail(refusedAs('HostUnavailable', failure.message))
        : failure._tag === 'WireLost' ||
            failure._tag === 'WireInvalid' ||
            failure._tag === 'WireUnreadable' ||
            failure._tag === 'WireFailed' ||
            failure._tag === 'WireUnavailable' ||
            failure._tag === 'HostRefused'
          ? Effect.fail(failure)
          : Effect.fail(refused(`the terminals floor could not answer: ${failure._tag}`)),
  );

const withheld = <A>(act: string): Effect.Effect<A, ExecutionsFailure> =>
  Effect.fail(refused(`${act} is authority over this installation's execution host; a command running under it does not hold that`));

const granted = <A>(act: string): Effect.Effect<A, ExecutionsFailure> =>
  Effect.fail(
    refused(`${act} is a granted act, decided over a permission and the revision it was taken at; this port carries no such decision`),
  );

const exactly = (launch: LaunchRequest): CommandEnvironmentRequest => ({
  inherit: false,
  entries: launch.command.environment.map((variable) => ({
    _tag: 'Set' as const,
    name: variable.name,
    value: variable.value,
  })),
});

export type CommandAdmitter = (
  operation: HostRequestRef,
  target: ResolvedExecutionTarget,
  launch: Extract<LaunchRequest, { readonly lifetime: 'command' }>,
) => Effect.Effect<CommandLaunch, TerminalFailure>;

export const makeTerminalExecutions = ({
  terminals,
  writing,
  evidence,
  discharge,
  host,
  caller,
  scope,
  admit,
}: {
  readonly terminals: Terminals['Service'];
  readonly writing: TerminalWriting['Service'];
  readonly evidence: ExecutionProcessEvidence['Service'];
  readonly discharge: Pick<Discharge['Service'], 'retire'>;
  readonly host: HostConnection;
  readonly caller: ExecutionCaller;
  readonly scope: Scope.Scope;
  readonly admit?: CommandAdmitter;
}): ExecutionPort => {
  const principal = principalOf(caller.actor);

  const held = Effect.fnUntraced(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<{ readonly state: ExecutionState; readonly native?: NativeProcess } | undefined, TerminalFailure> {
    const live = yield* host.port.state(execution);
    if (live !== undefined) return { state: live.state, native: live.native };
    const admitted = yield* host.port.command(execution);
    return admitted === undefined ? undefined : { state: admitted.state };
  });

  const answered = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    receipt: TerminalStartReceipt,
  ): Effect.fn.Return<StartAnswer, TerminalFailure> {
    if (receipt._tag === 'Refused') {
      return {
        _tag: 'Refused',
        operation,
        refusal: { _tag: hostRefusalOf[receipt.refusal.reason], reason: receipt.refusal.message },
      };
    }
    if (receipt._tag === 'Uncertain') return { _tag: 'Uncertain', effect: receipt.effect };
    const execution = receipt.record.execution;
    const standing = yield* held(execution);
    if (standing === undefined) {
      return yield* new TerminalUnavailable({
        owner: 'host',
        message: `The host ${receipt._tag === 'Accepted' ? 'accepted' : 'started'} ${execution.execution} and then held nothing under that reference.`,
      });
    }
    if (receipt._tag === 'Accepted') return { _tag: 'Accepted', operation, execution, state: standing.state };
    return {
      _tag: 'Started',
      operation,
      execution,
      state: standing.state,
      native: receipt.native ?? standing.native ?? {},
      deadline: receipt.deadline,
    };
  });

  const resolved = (launch: LaunchRequest): Effect.Effect<ResolvedExecutionTarget, TerminalFailure> =>
    terminals.target({ projectId: caller.projectId, kind: caller.kind, cwd: launch.command.cwd ?? caller.root });

  const bound = Effect.fnUntraced(function* (execution: ExecutionRef, act: string) {
    const standing = yield* terminals.record(execution.execution, execution.incarnation);
    if (standing === null) {
      return yield* new TerminalUnavailable({
        owner: 'store',
        message: `This installation holds no projection of ${execution.execution}${act === '' ? '' : `; ${act}`}.`,
      });
    }
    return standing;
  });

  const keyFor = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    mutation: TerminalOperationKey['mutation'],
    execution: ExecutionRef,
  ): Effect.fn.Return<TerminalOperationKey, TerminalFailure> {
    const standing = yield* bound(execution, '');
    if (standing.projectId !== caller.projectId) {
      return yield* new TerminalRefused({
        reason: 'ineligible',
        message: `${execution.execution} belongs to another project of this installation; this port takes keys only for the one it is bound to.`,
      });
    }
    return {
      projectId: caller.projectId,
      operationId: operation.operation,
      requester: principal,
      mutation,
      targetKey: standing.targetKey,
      execution,
    };
  });

  return {
    start: Effect.fnUntraced(
      function* (operation, launch) {
        if (launch.lifetime === 'command') {
          if (admit === undefined) {
            return yield* Effect.fail(
              refused(
                'starting bounded command work is admitted under a policy that binds its origin and limits; this port resolves none of them',
              ),
            );
          }
          const target = yield* resolved(launch);
          const authority = yield* admit(operation, target, launch);
          const receipt = yield* terminals.start({
            actor: caller.actor,
            operationId: operation.operation,
            target,
            targetKey: authority.prepared.targetKey,
            program: launch.command.program,
            args: launch.command.args,
            transport: launch.transport._tag === 'pty' ? 'pty' : 'pipes',
            lifetime: 'call',
            geometry: launch.transport._tag === 'pty' ? launch.transport.geometry : undefined,
            stdin: launch.transport._tag === 'pipes' ? launch.transport.stdin : undefined,
            environment: exactly(launch),
            purpose: launch.purpose,
            command: authority,
          });
          return yield* answered(operation, receipt);
        }
        const target = yield* resolved(launch);
        const targetKey = targetKeyOf(targetIdentity(target, principal, principal));
        const receipt = yield* terminals.start({
          actor: caller.actor,
          operationId: operation.operation,
          target,
          targetKey,
          program: launch.command.program,
          args: launch.command.args,
          transport: launch.transport._tag === 'pty' ? 'pty' : 'pipes',
          lifetime: launch.lifetime,
          geometry: launch.transport._tag === 'pty' ? launch.transport.geometry : undefined,
          stdin: launch.transport._tag === 'pipes' ? launch.transport.stdin : undefined,
          streaming: launch.transport._tag === 'pipes' ? launch.transport.streaming : undefined,
          environment: exactly(launch),
          purpose: launch.purpose,
          budget: launch.budget,
        });
        return yield* answered(operation, receipt);
      },
      (effect) => carried(effect.pipe(Scope.provide(scope))),
    ),
    status: () => host.port.status(),
    capabilities: () => host.port.capabilities(),
    served: () => host.port.served(),
    generation: () => host.port.generation(),
    list: () => withheld("listing this installation's executions"),
    changes: () => withheld("reading what moved among this installation's executions"),
    state: (execution) => host.port.state(execution),
    ending: (execution) => host.port.ending(execution),
    retained: (execution) => host.port.retained(execution),
    command: (execution) => host.port.command(execution),
    commands: () => withheld("reading the command inventory of this installation's execution host"),
    commandsAt: (refs) => host.port.commandsAt(refs),
    revise: () => granted("revising a bounded command's deadline"),
    operation: (operation) => host.port.operation(operation),
    preventStop: (operation, execution) => host.port.preventStop(operation, execution),
    callResult: (operation, options) => host.port.callResult(operation, options),
    read: (cursor, limit) => host.port.read(cursor, limit),
    subscribe: (source, credits) =>
      source._tag === 'Inventory'
        ? Stream.fromEffect(withheld<never>("following the command inventory of this installation's execution host"))
        : host.port.subscribe(source, credits),
    screen: (execution, request) => host.port.screen(execution, request),
    point: (execution, request) => host.port.point(execution, request),
    foreground: (execution) => host.port.foreground(execution),
    processes: (execution) => carried(evidence.processes(execution)),
    listeners: (execution) => carried(evidence.ports(execution)),
    hostListeners: () => withheld("reading the listening surface of this installation's namespace"),
    cancelStart: (operation, cause, trigger, when = 'always') => host.port.cancelStart(operation, cause, trigger, when),
    stop: Effect.fnUntraced(function* (operation, execution, cause, action, trigger) {
      const key = yield* keyFor(operation, 'stop', execution);
      const standing = yield* bound(execution, 'it cannot be stopped through this port');
      if (standing.projectId !== caller.projectId) {
        return yield* new TerminalRefused({
          reason: 'ineligible',
          message: `${execution.execution} belongs to another project of this installation; this port ends only the work of the one it is bound to.`,
        });
      }
      return yield* terminals.stop(caller.projectId, key, execution, standing.revision, cause, action, trigger);
    }, carried),
    retire: (operation, execution) => carried(discharge.retire(caller.projectId, operation, execution)),
    input: Effect.fnUntraced(function* (execution, lane, request) {
      const standing = yield* bound(execution, 'it cannot be typed into through this port');
      if (standing.projectId !== caller.projectId) {
        return yield* new TerminalRefused({
          reason: 'ineligible',
          message: `${execution.execution} belongs to another project of this installation; this port types only into the work of the one it is bound to.`,
        });
      }
      return yield* writing.input(
        execution,
        { binding: lane.binding, principal, runId: caller.runId },
        request,
        TERMINAL_PERMISSION_REVISION,
      );
    }, carried),
    custody: () => granted('moving custody of an execution'),
    signal: () => granted('signalling an execution outside its input queue'),
    openBinding: (asking, execution) =>
      execution === undefined || asking !== principal
        ? granted('opening a lane outside this caller’s own executions')
        : carried(
            Effect.gen(function* () {
              const record = yield* bound(execution, 'no lane opens into it through this port');
              if (record.projectId !== caller.projectId) {
                return yield* new TerminalRefused({
                  reason: 'ineligible',
                  message: `${execution.execution} belongs to another project of this installation; this port opens lanes only into the work of the one it is bound to.`,
                });
              }
              const opened = yield* writing.openHeldLane(asking, caller.projectId, execution, caller.runId);
              return { _tag: 'Bound', binding: opened.binding, principal: asking, epoch: opened.epoch } as const;
            }),
          ),
    closeBinding: (binding, asking) =>
      asking !== principal
        ? granted('closing another caller’s binding')
        : carried(
            Effect.gen(function* () {
              const grant = writing.agentGrant(asking, binding, caller.runId);
              if (grant !== undefined) yield* writing.closeAgentBinding(grant.projectId, grant.execution, asking, binding, caller.runId);
              return { _tag: 'Unbound', binding } as const;
            }),
          ),
    take: () => withheld('taking host custody'),
    fence: () => withheld('fencing host custody'),
    release: () => withheld('releasing host custody'),
    grant: () => withheld('granting the host a share of the machine'),
    quiesce: () => withheld('quiescing the host for a controlled restart'),
    resume: () => withheld('resuming a fenced host'),
    prepare: () => withheld('preparing the host for the next logic'),
    yield: () => withheld('asking the host logic to yield its place'),
    shutdown: () => withheld('shutting the host down'),
    pace: () => withheld("moving the pace of agents' commands"),
    disown: () => withheld("disowning another owner's kept command output"),
    load: () => withheld('subscribing to the load of this installation'),
    endProcess: () => withheld('ending a machine process'),
    endResidual: () => withheld('ending a process an execution left running'),
  };
};

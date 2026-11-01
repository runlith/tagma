import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalTargets } from '../contract/service/targets.js';
import { RootUses } from '../../workspace/contract/service/roots.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { Environments } from '../../workspace/contract/service/environments.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { TerminalRows } from '../store/terminalRows.js';
import { CommandWaiters } from '../contract/service/commands.js';
import { CommandRows } from '../store/commandRows.js';
import { TerminalGrants } from '../contract/service/grants.js';
import { Executions } from '@runlith/executions/Executions';
import { TerminalInput } from '@runlith/executions/TerminalInput';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import type { HostRequestKey } from '@runlith/executions/protocol/execution';
import { makeTerminalRecord, makeCommandRecord } from './reads.js';
import { TerminalWriting } from '../contract/service/writing.js';
import type { TerminalWatched } from '../contract/service/endings.js';
import { Clock, Effect, Queue, type Scope } from 'effect';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { LaunchRequest, StartAnswer } from '@runlith/executions/protocol/launch';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import {
  command as commandTable,
  commandWait,
  openTerminal,
  terminal,
  terminalIntent,
  terminalRequestKey,
  terminalRequestKeyTally,
} from '../store/terminal.js';
import { deliveryRows } from '../contract/service/commands.js';
import { rootUse, rootUseHold } from '../../workspace/store/tables.js';
import { isRegistryChanged } from '../../workspace/contract/wire/roots.js';
import { environmentUse as environmentUseTable } from '../../workspace/store/tables.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalRefused, TerminalUnavailable, hostRefusalReason, hostSentence } from '../contract/wire/refusals.js';
import { principalOf } from './principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import { placeOf, targetCwd } from '../contract/wire/targets.js';
import type { TerminalOperationKey, TerminalOperationState } from '../contract/wire/requestKeys.js';
import type { EnvironmentUseId } from '../../workspace/contract/wire/environments.js';
import type { UseId } from '../../workspace/contract/wire/ids.js';
import { keyedEnvironment, terminalEnvironment } from './environment.js';
import { shellDigest } from '../../platform/credentials/grants.js';
import type { LaunchPreparation } from '../contract/service/access.js';
import type { AcquiredExecutionTarget, TargetRequest } from '../contract/service/targets.js';
import { commandLineOf, admissionTime, type CommandCreator, type CommandIntentProvenance } from '../contract/wire/commands.js';
import { principalOfSubject } from '../contract/wire/commandSubject.js';
import type { TerminalFailure, TerminalStart, TerminalStartReceipt } from '../contract/service/terminals.js';
import type { PipeHandle } from '../contract/service/writing.js';
import type { CommandLaunch } from '../contract/service/commands.js';
import { threadOf } from './refs.js';

type Birth = Pick<TerminalRecord, 'rootId' | 'launchedFor' | 'shellKey'>;

type TerminalHoldings = { readonly rootUse?: UseId; readonly environmentUse?: EnvironmentUseId };

export const makeTerminalStart = Effect.fnUntraced(function* ({
  installation,
  programVersion,
  watched,
  ready,
}: {
  readonly installation: InstallationId;
  readonly programVersion: string;
  readonly watched: Queue.Enqueue<TerminalWatched>;
  readonly ready: Effect.Effect<void>;
}) {
  const units = yield* MachineUnits;
  const requestKeys = yield* RequestKeys;
  const targets = yield* TerminalTargets;
  const uses = yield* RootUses;
  const intents = yield* TerminalIntents;
  const environments = yield* Environments;
  const identity = yield* SessionIdentity;
  const terminalRows = yield* TerminalRows;
  const waiters = yield* CommandWaiters;
  const commandRows = yield* CommandRows;
  const grants = yield* TerminalGrants;
  const host = yield* Executions;
  const terminalInput = yield* TerminalInput;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const readRecord = yield* makeTerminalRecord;
  const readCommand = yield* makeCommandRecord;
  const writing = yield* TerminalWriting;

  const start = Effect.fn('Terminals.start')(function* (
    request: TerminalStart,
  ): Effect.fn.Return<TerminalStartReceipt, TerminalFailure, Scope.Scope> {
    const holder = principalOf(request.actor);
    const consumer = { kind: request.command === undefined ? 'terminal' : 'command', id: request.operationId };
    const requires = request.lifetime === 'held' ? (['exec', 'heldExecution'] as const) : (['exec'] as const);
    if (request.transport === 'pty' && request.geometry === undefined) {
      return yield* new TerminalRefused({
        reason: 'ineligible',
        message: 'A pty execution is started with its geometry; a terminal with no size is not a terminal.',
      });
    }
    if (
      request.stdinHeld === true &&
      (request.transport !== 'pipes' || request.purpose !== 'internal' || request.lifetime !== 'call' || request.interactive !== undefined)
    ) {
      return yield* new TerminalRefused({
        reason: 'ineligible',
        message:
          'Held stdin is an internal, call-lifetime pipes start with no interactive claim; anything else types through a lane of its own.',
      });
    }
    if (request.command !== undefined) {
      const refused = commandRefusal(request);
      if (refused !== undefined) return yield* refused;
    }
    const key: TerminalOperationKey = {
      projectId: request.target.projectId,
      operationId: request.operationId,
      requester: holder,
      mutation: 'start',
      targetKey: request.targetKey,
    };
    const taken = yield* units.read((unit) => requestKeys.operation(unit, key.projectId, key.operationId));
    if (taken._tag !== 'Unknown') return yield* standing(key, taken);

    yield* Effect.interruptible(ready);
    const acquired = yield* targets.acquire(request.target, consumer, requires);
    const launch = yield* launchOf(request, acquired, holder).pipe(
      Effect.tap((launch) => request.prepared?.(launch) ?? Effect.void),
      Effect.tapError(() => abandon(acquired, consumer)),
      Effect.onInterrupt(() => abandon(acquired, consumer)),
    );
    const held = threadOf(holder);
    const incoming =
      request.command === undefined ? (held === null ? undefined : ThreadId.make(held)) : commandOwnerThread(request.command.prepared);
    const rootId = placeOf(acquired.admitted);
    const birth: Birth = {
      rootId: rootId,
      launchedFor: request.launchedFor,
      shellKey: request.shellKey === undefined ? undefined : shellDigest(request.shellKey),
    };
    let admitted = acquired;
    const reserved = yield* Effect.suspend(() => reserve(key, admitted, launch, incoming, birth, request.command)).pipe(
      Effect.tapError((failure) =>
        isRegistryChanged(failure)
          ? Effect.map(targets.readmit(admitted), (fresh) => {
              admitted = fresh;
            })
          : Effect.void,
      ),
      Effect.retry({ while: isRegistryChanged }),
      Effect.tapError(() => abandon(acquired, consumer)),
      Effect.onInterrupt(() => abandon(acquired, consumer)),
    );
    return yield* dispatch(key, reserved, birth, launch, request.interactive, request.stdinHeld, request.label);
  });

  const target = Effect.fn('Terminals.target')(function* (request: TargetRequest) {
    return yield* targets.resolve(request);
  });

  const standing = Effect.fn('Terminals.standing')(function* (
    key: TerminalOperationKey,
    state: TerminalOperationState,
  ): Effect.fn.Return<TerminalStartReceipt, TerminalFailure> {
    const operation = ref(key.operationId);
    if (state._tag === 'Admitted' || (state._tag === 'Settled' && state.execution !== undefined)) {
      const execution = state._tag === 'Admitted' ? state.execution : state.execution;
      const command = execution === undefined ? null : yield* readCommand(execution.execution, execution.incarnation);
      if (command !== null && command.projectId === key.projectId) return { _tag: 'Accepted', operation, record: command };
      const record = execution === undefined ? null : yield* readRecord(execution.execution, execution.incarnation);
      if (record !== null) return { _tag: 'Started', operation, record };
    }
    if (state._tag === 'Uncertain') return { _tag: 'Uncertain', operation, effect: state.effect };
    return {
      _tag: 'Refused',
      operation,
      refusal: new TerminalRefused({
        reason: state._tag === 'Expired' ? 'operation-expired' : 'operation-conflict',
        message: `Operation ${key.operationId} is already taken and stands at ${state._tag}; read it rather than starting again.`,
      }),
    };
  });

  const reserve = Effect.fn('Terminals.reserve')(function* (
    key: TerminalOperationKey,
    acquired: AcquiredExecutionTarget,
    launch: LaunchRequest,
    incoming: ThreadId | undefined,
    birth: Birth,
    command?: CommandLaunch,
  ): Effect.fn.Return<TerminalHoldings, TerminalFailure> {
    const environmentUse = acquired.acquired.use._tag === 'Retained' ? acquired.acquired.use.use.useId : undefined;
    return yield* units.write(
      writes('start.reserve', [rootUse, rootUseHold, terminalRequestKey, terminalRequestKeyTally, terminalIntent]),
      (unit: WriteUnit<'machine'>) =>
        Effect.gen(function* () {
          if (command !== undefined) yield* command.recheck(unit);
          const use = yield* uses.reserve(unit, {
            footprint: acquired.admitted.admission.footprint,
            consumer: { kind: command === undefined ? 'terminal' : 'command', id: key.operationId },
            mode: 'shared',
          });
          yield* requestKeys.register(unit, key);
          yield* intents.fence(
            unit,
            {
              key,
              phase: 'reserved',
              holdings: { rootUse: use.useId, environmentUse: environmentUse },
              incoming: incoming,
              ...birth,
              openedAt: yield* Clock.currentTimeMillis,
            },
            command === undefined ? undefined : commandOriginOf(command, launch),
          );
          return { rootUse: use.useId, environmentUse: environmentUse };
        }),
    );
  });

  const abandon = Effect.fn('Terminals.abandon')(function* (
    acquired: AcquiredExecutionTarget,
    consumer: { readonly kind: string; readonly id: string },
  ) {
    const receipt = acquired.acquired.use;
    if (receipt._tag !== 'Retained') return;
    yield* environments.releaseUse(receipt.use.useId, consumer, 'never-applied').pipe(
      Effect.catch((refusal) =>
        Effect.logWarning('a terminal reservation that never applied could not give its environment use back', {
          useId: receipt.use.useId,
          refusal: refusal._tag,
        }),
      ),
    );
  });

  const launchOf = Effect.fn('Terminals.launch')(function* (
    request: TerminalStart,
    acquired: AcquiredExecutionTarget,
    holder: Principal,
  ): Effect.fn.Return<LaunchRequest, TerminalFailure> {
    const cwd = targetCwd(acquired.admitted.target);
    const environment = yield* acquired.acquired.commandEnvironment
      .materialize(
        keyedEnvironment(terminalEnvironment(request.transport, request.environment, programVersion), request.shellKey, identity),
      )
      .pipe(
        Effect.mapError(
          (refusal) =>
            new TerminalUnavailable({
              owner: 'environment',
              message: `The bound environment could not be read, so no child may start under a guess at it: ${refusal.reason}`,
            }),
        ),
      );
    if (request.command !== undefined) {
      return commandLaunch(request, request.command, targetOf(acquired, cwd), cwd, environment);
    }
    const geometry = request.geometry;
    const purpose = request.purpose ?? 'command';
    const agents = threadOf(holder) !== null || request.launchedFor !== undefined;
    return {
      command: { program: request.program, args: request.args, environment, cwd },
      transport:
        request.transport === 'pty' && geometry !== undefined
          ? { _tag: 'pty', geometry }
          : { _tag: 'pipes', stdin: request.stdin ?? 'pipe', streaming: request.streaming },
      lifetime: request.lifetime,
      purpose,
      budget: request.budget,
      target: targetOf(acquired, cwd),
      holder,
      origin: holder,
      paced: purpose === 'command' && agents ? true : undefined,
    };
  });

  const dispatch = Effect.fn('Terminals.dispatch')(function* (
    key: TerminalOperationKey,
    holdings: TerminalHoldings,
    birth: Birth,
    launch: LaunchRequest,
    interactive: TerminalStart['interactive'],
    stdinHeld: TerminalStart['stdinHeld'],
    label: TerminalStart['label'],
  ): Effect.fn.Return<TerminalStartReceipt, TerminalFailure, Scope.Scope> {
    const operation = ref(key.operationId);
    yield* units.write(writes('start.dispatch', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
      intents.advance(unit, key.projectId, key.operationId, 'dispatched'),
    );
    const outcome = yield* Effect.result(host.start(operation, launch));
    if (outcome._tag === 'Failure') {
      const failure = outcome.failure;
      const unapplied =
        failure._tag === 'HostRefused' ||
        failure._tag === 'WireFailed' ||
        ((failure._tag === 'WireUnavailable' || failure._tag === 'WireLost') && !failure.sent);
      if (unapplied) yield* unwind(key, holdings, launch.lifetime === 'command' ? 'command' : 'terminal');
      else
        yield* units.write(writes('start.dispatch', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
          intents.advance(unit, key.projectId, key.operationId, 'uncertain'),
        );
      return yield* outcome.failure;
    }
    return yield* accept(key, holdings, birth, launch, outcome.success, interactive, stdinHeld, label);
  });

  const unwind = Effect.fn('Terminals.unwind')(function* (
    key: TerminalOperationKey,
    holdings: TerminalHoldings,
    kind: 'terminal' | 'command' = 'terminal',
  ): Effect.fn.Return<void, TerminalFailure> {
    const consumer = { kind, id: key.operationId };
    yield* units
      .write(
        writes('start.unwind', [rootUse, environmentUseTable, terminalRequestKey, terminalRequestKeyTally, terminalIntent]),
        (unit: WriteUnit<'machine'>) =>
          Effect.gen(function* () {
            if (holdings.rootUse !== undefined) {
              yield* uses.release(unit, { useId: holdings.rootUse, consumer, outcome: 'unapplied' });
            }
            if (holdings.environmentUse !== undefined) {
              yield* environments.release(unit, holdings.environmentUse, consumer, 'never-applied');
            }
            yield* intents.settle(unit, key.projectId, key.operationId, { _tag: 'Settled' });
          }),
      )
      .pipe(
        Effect.catch((refusal) =>
          Effect.logWarning('a terminal reservation that never applied kept what it reserved', {
            operation: key.operationId,
            refusal: refusal._tag,
          }),
        ),
      );
  });

  const accept = Effect.fn('Terminals.accept')(function* (
    key: TerminalOperationKey,
    holdings: TerminalHoldings,
    birth: Birth,
    launch: LaunchRequest,
    outcome: StartAnswer,
    interactive: TerminalStart['interactive'],
    stdinHeld: TerminalStart['stdinHeld'],
    label: TerminalStart['label'],
  ): Effect.fn.Return<TerminalStartReceipt, TerminalFailure, Scope.Scope> {
    const operation = ref(key.operationId);
    switch (outcome._tag) {
      case 'Started': {
        if (launch.lifetime === 'command') {
          yield* units.write(writes('start.accept', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
            intents.settle(unit, key.projectId, key.operationId, { _tag: 'Settled' }),
          );
          yield* unwind(key, holdings, 'command');
          return {
            _tag: 'Refused',
            operation,
            refusal: new TerminalRefused({
              reason: 'host-state',
              message: `The host answered a terminal start for bounded command work (${outcome.execution.execution}); commands project from acceptance, so nothing was kept.`,
            }),
          };
        }
        const record: TerminalRecord = {
          projectId: key.projectId,
          execution: outcome.execution,
          transport: outcome.state.transport,
          lifetime: launch.lifetime,
          targetKey: key.targetKey,
          holder: launch.holder,
          origin: launch.origin,
          revision: 0,
          holdings,
          heldBy: threadOf(launch.holder) === null ? undefined : (threadOf(launch.holder) as ThreadId),
          label: label,
          commandLine: commandLineOf(launch.command.program, launch.command.args),
          program: launch.command.program,
          cwd: launch.command.cwd,
          ...birth,
          acceptedAt: yield* Clock.currentTimeMillis,
        };
        yield* units.write(
          writes('start.accept', [terminal, terminalRequestKey, terminalRequestKeyTally, terminalIntent, openTerminal]),
          (unit) =>
            Effect.gen(function* () {
              yield* terminalRows.project(unit, record);
              yield* intents.settle(unit, key.projectId, key.operationId, {
                _tag: 'Settled',
                executionId: outcome.execution.execution,
                incarnation: outcome.execution.incarnation,
              });
            }),
        );
        let binding: BindingId | undefined;
        let pipe: PipeHandle | undefined;
        if (interactive !== undefined) {
          const lane = yield* Effect.result(starterLane(record, launch.holder, interactive));
          if (lane._tag === 'Success') binding = lane.success;
          else {
            yield* Effect.logWarning('a started execution’s starter lane did not open; its first typing act opens one', {
              execution: outcome.execution.execution,
              reason: lane.failure._tag,
            });
          }
        } else if (stdinHeld === true) {
          const held = yield* Effect.result(pipeLane(record, launch.holder));
          if (held._tag === 'Success') pipe = held.success;
          else {
            yield* Effect.logWarning(
              'a started execution’s stdin lane did not open; it answers Started with no pipe, and its starter stops it',
              {
                execution: outcome.execution.execution,
                reason: held.failure._tag,
              },
            );
          }
        }
        yield* Queue.offer(watched, { projectId: key.projectId, execution: outcome.execution });
        return {
          _tag: 'Started',
          operation,
          record,
          native: outcome.native,
          deadline: outcome.deadline,
          binding: binding,
          pipe: pipe,
        };
      }
      case 'Cancelled':
        yield* unwind(key, holdings, launch.lifetime === 'command' ? 'command' : 'terminal');
        return {
          _tag: 'Refused',
          operation,
          refusal: new TerminalRefused({
            reason: 'stale',
            message: 'This start was cancelled before any spawn; its key can never become a launch.',
          }),
        };
      case 'Refused':
        yield* unwind(key, holdings, launch.lifetime === 'command' ? 'command' : 'terminal');
        return {
          _tag: 'Refused',
          operation,
          refusal: new TerminalRefused({
            reason: hostRefusalReason[outcome.refusal._tag],
            message: `The host refused this launch: ${outcome.refusal._tag} — ${hostSentence(outcome.refusal)}`,
          }),
        };
      case 'Uncertain':
        yield* units.write(writes('start.accept', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
          intents.settle(unit, key.projectId, key.operationId, { _tag: 'Uncertain', effect: outcome.effect }),
        );
        return { _tag: 'Uncertain', operation, effect: outcome.effect };
      case 'Accepted': {
        const origin = yield* units.read((unit) => intents.commandOrigin(unit, key.projectId, key.operationId));
        if (origin === null) {
          yield* units.write(writes('start.accept', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
            intents.advance(unit, key.projectId, key.operationId, 'uncertain'),
          );
          return {
            _tag: 'Refused',
            operation,
            refusal: new TerminalRefused({
              reason: 'host-state',
              message: `The host accepted this launch as bounded command work (${outcome.execution.execution}) rather than starting a terminal; this installation projects calls and held executions.`,
            }),
          };
        }
        const debts =
          origin.wait === 'background' && origin.createdRun !== undefined && origin.createdToolCall !== undefined
            ? yield* waiters.debts
            : null;
        const record = yield* units.write(
          writes(
            'start.record',
            [commandTable, commandWait, deliveryRows, terminalRequestKey, terminalRequestKeyTally, terminalIntent],
            ...(debts === null ? [] : [debts.calls]),
          ),
          (unit) =>
            Effect.gen(function* () {
              const admitted = yield* commandRows.admitCommand(unit, key, outcome.execution);
              const made = admitted.origin;
              if (debts !== null && made._tag === 'Thread' && made.run !== undefined && made.toolCall !== undefined) {
                yield* debts.release(unit, { thread: made.thread, run: made.run, toolCall: made.toolCall });
              }
              yield* intents.settle(unit, key.projectId, key.operationId, {
                _tag: 'Settled',
                executionId: outcome.execution.execution,
                incarnation: outcome.execution.incarnation,
              });
              return admitted;
            }),
        );
        yield* Queue.offer(watched, { projectId: key.projectId, execution: outcome.execution });
        return { _tag: 'Accepted', operation, record };
      }
    }
  });

  const starterLane = Effect.fn('Terminals.starterLane')(function* (
    record: TerminalRecord,
    holder: Principal,
    interactive: { readonly revision: number; readonly runId?: string },
  ): Effect.fn.Return<BindingId, TerminalFailure> {
    const opened = yield* writing.openAgentBinding(holder, {
      road: 'agent',
      projectId: record.projectId,
      execution: record.execution,
      decisionRevision: interactive.revision,
      runId: interactive.runId,
    });
    return opened.binding;
  });

  const pipeLane = Effect.fn('Terminals.pipeLane')(function* (
    record: TerminalRecord,
    holder: Principal,
  ): Effect.fn.Return<PipeHandle, TerminalFailure, Scope.Scope> {
    const opened = yield* Effect.acquireRelease(terminalInput.openBinding(holder, record.execution), (answer) =>
      answer._tag === 'Bound' ? Effect.asVoid(grants.closeOrKeep(answer.binding, holder)) : Effect.void,
    );
    if (opened._tag !== 'Bound') {
      return yield* new TerminalRefused({
        reason: 'no-binding',
        message: `The host could not open this child’s stdin lane (${opened._tag}).`,
      });
    }
    return { execution: record.execution, binding: opened.binding, principal: holder };
  });

  const targetOf = (acquired: AcquiredExecutionTarget, cwd: string) => ({
    environment: acquired.admitted.target.binding.environmentId,
    namespace: acquired.admitted.target.binding.namespaceId,
    cwd,
    dependencies: [...(acquired.acquired.use._tag === 'Retained' ? [acquired.acquired.use.use.useId] : [])],
  });

  const commandRefusal = (request: TerminalStart): TerminalRefused | undefined => {
    if (request.transport !== 'pipes') {
      return new TerminalRefused({
        reason: 'ineligible',
        message: 'A bounded command runs over pipes; the offered capability qualifies no terminal transport for commands.',
      });
    }
    if (request.geometry !== undefined) {
      return new TerminalRefused({ reason: 'ineligible', message: 'A bounded command names no pty geometry; it runs over pipes.' });
    }
    if (request.stdin !== undefined && request.stdin !== 'ignore') {
      return new TerminalRefused({ reason: 'ineligible', message: 'A bounded command reads no input; its stdin is ignored.' });
    }
    if (request.interactive !== undefined) {
      return new TerminalRefused({
        reason: 'ineligible',
        message: 'Nobody types into a bounded command; it carries no interactive claim.',
      });
    }
    if (request.budget !== undefined) {
      return new TerminalRefused({
        reason: 'ineligible',
        message: 'A bounded command carries its bound in its prepared act, not a second budget.',
      });
    }
    if (request.command !== undefined && request.command.prepared.targetKey !== request.targetKey) {
      return new TerminalRefused({
        reason: 'stale-authority',
        message: 'This start names a target its prepared act was not bound to; prepare over the target being started.',
      });
    }
    return undefined;
  };

  const commandOwnerThread = (prepared: LaunchPreparation): ThreadId | undefined =>
    prepared.request.owner._tag === 'Thread' ? prepared.request.owner.thread : undefined;

  const creatorPrincipal = (creator: CommandCreator): Principal =>
    principalOfSubject(creator._tag === 'Thread' ? { _tag: 'Thread', thread: creator.thread } : { _tag: 'Operator' });

  const commandOriginOf = (command: CommandLaunch, launch: LaunchRequest): CommandIntentProvenance => {
    const creator = command.prepared.request.creator;
    return {
      wait: command.wait ?? 'foreground',
      label: command.label,
      commandLine: commandLineOf(launch.command.program, launch.command.args),
      program: launch.command.program,
      cwd: launch.command.cwd,
      serviceScope: command.prepared.request.owner._tag === 'Service' ? command.prepared.request.owner.scope : undefined,
      createdBy: creatorPrincipal(creator),
      createdRun: creator._tag === 'Thread' && creator.run !== undefined ? creator.run : undefined,
      createdToolCall: creator._tag === 'Thread' && creator.toolCall !== undefined ? creator.toolCall : undefined,
      policyIdentity: command.prepared.receipt.policyIdentity,
      time: command.prepared.receipt.time,
    };
  };

  const commandLaunch = (
    request: TerminalStart,
    command: CommandLaunch,
    target: ReturnType<typeof targetOf>,
    cwd: string,
    environment: LaunchRequest['command']['environment'],
  ): Extract<LaunchRequest, { readonly lifetime: 'command' }> => ({
    command: { program: request.program, args: request.args, environment, cwd: command.prepared.request.cwd ?? cwd },
    transport: { _tag: 'pipes', stdin: 'ignore' },
    lifetime: 'command',
    purpose: request.purpose ?? 'internal',
    admission: {
      origin: {
        scope: `project:${request.target.projectId}`,
        owner: principalOfSubject(command.prepared.request.owner),
        cohort: command.prepared.receipt.policyIdentity,
      },
      limits: command.prepared.receipt.limits,
      policyIdentity: command.prepared.receipt.policyIdentity,
      ...admissionTime(command.prepared.receipt.time),
    },
    target,
    holder: principalOfSubject(command.prepared.request.owner),
    origin: creatorPrincipal(command.prepared.request.creator),
    paced: request.purpose === 'command' && command.prepared.request.owner._tag === 'Thread' ? true : undefined,
  });

  return { start, target };
});

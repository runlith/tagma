import { Effect } from 'effect';
import {
  CommandRefused,
  type CommandAcceptance,
  type CommandObservation,
  type CommandRequest,
  type CommandWork,
} from '@runlith/agent-tools/CommandWork';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type {
  EffectiveEnvironment,
  ExecutionRef,
  HostRequestKey,
  HostRequestRef,
  InstallationId,
} from '@runlith/executions/protocol/execution';
import type { CommandCreator, CommandWaitMode } from '../../contract/wire/commands.js';
import type { CommandSubject } from '../../contract/wire/commandSubject.js';
import { TerminalRefused } from '../../contract/wire/refusals.js';
import type { ResolvedExecutionTarget } from '../../contract/wire/targets.js';
import type { TerminalActor } from '../../contract/wire/terminals.js';
import type { CommandAccess, LaunchPreparation } from '../../contract/service/access.js';
import type { ManagedCommands } from '../../contract/service/commands.js';
import type { WorldLease } from '../../contract/service/worlds.js';
import type { CommandAdmitter } from '../../terminals/executionPort.js';
import type { WorldLeasing } from '../cache.js';
import { commandRun, launchOf, prepare } from './launch.js';
import { accepted, decidingRule, watching, wireRefusal } from './results.js';
import { cancelling } from './stops.js';

export type ShellCommandBinding = {
  readonly installation: InstallationId;
  readonly projectId: number;
  readonly actor: TerminalActor;
  readonly owner: CommandSubject;
  readonly creator: CommandCreator;
  readonly target: ResolvedExecutionTarget;
  readonly environment: (env: Record<string, string | undefined>) => EffectiveEnvironment;
  readonly credits: number;
  readonly inspect: (execution: ExecutionRef) => string;
};

export type ShellRoad = {
  readonly executions: Executions['Service'] & Commands['Service'] & ExecutionRequest['Service'] & ExecutionFeed['Service'];
  readonly access: CommandAccess['Service'];
  readonly binding: ShellCommandBinding;
  readonly managed: ManagedCommands['Service'];
};

export type PreparedShellLaunch = {
  readonly prepared: LaunchPreparation;
  readonly wait: CommandWaitMode;
  readonly label?: string;
};

export class PreparedLaunches {
  private readonly held = new Map<string, PreparedShellLaunch>();

  readonly put = (operation: HostRequestKey, launch: PreparedShellLaunch): void => {
    this.held.set(operation, launch);
  };

  readonly take = (operation: HostRequestKey): PreparedShellLaunch | undefined => {
    const found = this.held.get(operation);
    this.held.delete(operation);
    return found;
  };

  readonly drop = (operation: HostRequestKey): void => {
    this.held.delete(operation);
  };
}

export const shellAdmitter =
  (launches: PreparedLaunches, access: CommandAccess['Service']): CommandAdmitter =>
  (operation) => {
    const standing = launches.take(operation.operation);
    if (standing === undefined) {
      return Effect.fail(
        new TerminalRefused({
          reason: 'ineligible',
          message:
            'This port admits the shell commands its own binding prepared, and none stands under this operation; start the command through the shell rather than asking the port directly.',
        }),
      );
    }
    const { prepared, wait, label } = standing;
    return Effect.succeed({
      prepared,
      wait,
      label: label,
      recheck: (unit) => access.recheck(unit, prepared),
    });
  };

export const makeShellCommands = ({
  launches,
  lease,
  ...road
}: ShellRoad & { readonly launches: PreparedLaunches; readonly lease: WorldLeasing }): CommandWork => {
  const admitting = Effect.fnUntraced(function* <A>(
    request: CommandRequest,
    observe: CommandObservation<A>,
    held: WorldLease,
  ): Effect.fn.Return<CommandAcceptance<A>, CommandRefused> {
    const operationId = request.operation;
    const operation: HostRequestRef = { installation: road.binding.installation, operation: operationId };
    const wait: CommandWaitMode = request.waitMs === 0 ? 'background' : 'foreground';
    const prepared = yield* prepare(road, request, operationId);
    launches.put(operationId, {
      prepared,
      wait,
      label: request.label === undefined || request.label.trim() === '' ? undefined : request.label.trim(),
    });
    const cancellation = yield* cancelling(road, request, operation, held);
    const settled = cancellation?.settle ?? Effect.void;
    const unsubmitted = (refused: CommandRefused) => (refused.certainty === 'unsubmitted' ? settled : Effect.void);
    const outcome = yield* road.executions.start(operation, launchOf(road, request, prepared)).pipe(
      Effect.tapCause(() => Effect.sync(() => launches.drop(operationId))),
      Effect.mapError((failure) => wireRefusal(operation, failure)),
      Effect.tapError(unsubmitted),
    );
    launches.drop(operationId);
    const execution = yield* accepted(operation, outcome).pipe(Effect.tapError(unsubmitted));
    const run = yield* commandRun(road, operation, execution, cancellation, decidingRule(prepared.receipt));
    const observed = yield* watching(observe(run).pipe(Effect.ensuring(settled)), held);
    return { run, observed };
  });

  return {
    start: Effect.fnUntraced(function* <A>(request: CommandRequest, observe: CommandObservation<A>) {
      if (request.stop !== undefined && request.stop.stopped() !== null) {
        return yield* new CommandRefused({
          reason: 'the run was aborted before this command was submitted',
          certainty: 'unsubmitted',
        });
      }
      const held = yield* lease();
      return yield* admitting(request, observe, held).pipe(Effect.onExit((exit) => (exit._tag === 'Success' ? Effect.void : held.release)));
    }),
  };
};

import { Deferred, Effect } from 'effect';
import {
  CommandRefused,
  CommandUnreadable,
  type CommandRequest,
  type CommandRun,
  type RuledAnswer,
} from '@runlith/agent-tools/CommandWork';
import type { ExecutionRef, HostRequestKey, HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { admissionTime, type CommandCreator } from '../../contract/wire/commands.js';
import { principalOfSubject } from '../../contract/wire/commandSubject.js';
import type { LaunchPreparation } from '../../contract/service/access.js';
import { bytes, commandPhase, deadlineOf, decided, refusalText, withEnding } from './results.js';
import { declaredStop, revising, stopping, type Cancellation } from './stops.js';
import type { ShellRoad } from './start.js';

const SHELL_TOOL = 'bash';

const creatorOf = (creator: CommandCreator, correlation: string): CommandCreator =>
  creator._tag === 'Thread' ? { ...creator, toolCall: correlation } : creator;

export const prepare = (
  road: ShellRoad,
  request: CommandRequest,
  operation: HostRequestKey,
): Effect.Effect<LaunchPreparation, CommandRefused> =>
  road.access
    .prepare({
      _tag: 'Launch',
      actor: road.binding.actor,
      scope: road.binding.projectId,
      target: road.binding.target,
      program: request.program,
      args: request.args,
      tool: SHELL_TOOL,
      requested: request.lifeMs,
      waitMs: request.waitMs,
      cwd: request.cwd,
      owner: road.binding.owner,
      creator: creatorOf(road.binding.creator, request.correlation),
      operation,
    })
    .pipe(
      Effect.flatMap((act) => {
        const { request: asked, receipt } = act;
        if (asked._tag !== 'Launch' || receipt === undefined) {
          return Effect.fail(
            new CommandRefused({
              reason: 'the policy prepared no launch of its own for this command',
              certainty: 'unsubmitted',
            }),
          );
        }
        return Effect.succeed({ ...act, request: asked, receipt } satisfies LaunchPreparation);
      }),
      Effect.catch((failure) =>
        Effect.fail(
          new CommandRefused({
            reason: refusalText(failure),
            certainty: 'unsubmitted',
          }),
        ),
      ),
    );

export const launchOf = (
  road: ShellRoad,
  request: CommandRequest,
  prepared: LaunchPreparation,
): Extract<LaunchRequest, { readonly lifetime: 'command' }> => {
  const principal = principalOfSubject(road.binding.owner);
  return {
    command: {
      program: request.program,
      args: request.args,
      environment: road.binding.environment(request.env),
      cwd: prepared.request.cwd ?? request.cwd,
    },
    transport: { _tag: 'pipes', stdin: 'ignore' },
    lifetime: 'command',
    purpose: 'command',
    admission: {
      origin: {
        scope: `project:${road.binding.projectId}`,
        owner: principal,
        cohort: prepared.receipt.policyIdentity,
      },
      limits: prepared.receipt.limits,
      policyIdentity: prepared.receipt.policyIdentity,
      ...admissionTime(prepared.receipt.time),
    },
    target: {
      environment: road.binding.target.binding.environmentId,
      namespace: road.binding.target.binding.namespaceId,
      cwd: prepared.request.cwd ?? request.cwd,
      dependencies: [],
    },
    holder: principal,
    origin: principal,
  };
};

export const commandRun = Effect.fnUntraced(function* (
  road: ShellRoad,
  operation: HostRequestRef,
  execution: ExecutionRef,
  cancellation: Cancellation | undefined,
  rule: string | undefined,
): Effect.fn.Return<CommandRun> {
  const snapshot = yield* Effect.result(road.executions.command(execution));
  return {
    operation,
    execution,
    deadline: deadlineOf(snapshot),
    standing: Effect.map(Effect.result(road.executions.command(execution)), deadlineOf),
    rule: rule,
    inspect: road.binding.inspect(execution),
    phase: commandPhase(road.executions, execution),
    result: decided(road.executions, operation, execution, road.binding.credits).pipe(
      Effect.flatMap((result) => measured(road, result, operation, execution, cancellation)),
    ),
    revise: (remainingMs, authority) => revising(road, execution, { remainingMs, authority }),
    background: Effect.suspend(() => road.managed.background(execution)).pipe(
      Effect.mapError((failure) => new CommandUnreadable({ reason: refusalText(failure) })),
    ),
    foreground: Effect.suspend(() => road.managed.foreground(execution)).pipe(
      Effect.mapError((failure) => new CommandUnreadable({ reason: refusalText(failure) })),
    ),
    measured: (words) =>
      road.managed.measured(execution, words).pipe(Effect.mapError((failure) => new CommandUnreadable({ reason: refusalText(failure) }))),
    stdout: bytes(road.executions, execution, 'stdout', road.binding.credits),
    stderr: bytes(road.executions, execution, 'stderr', road.binding.credits),
    outputFile: road.executions.state(execution).pipe(
      Effect.map((summary) => summary?.outputFile),
      Effect.mapError((failure) => new CommandUnreadable({ reason: refusalText(failure) })),
    ),
  };
});

const measured = (
  road: ShellRoad,
  result: RuledAnswer,
  operation: HostRequestRef,
  execution: ExecutionRef,
  cancellation: Cancellation | undefined,
): Effect.Effect<RuledAnswer> => {
  if (
    cancellation === undefined ||
    cancellation.stop.stopped() === null ||
    result._tag !== 'Decided' ||
    result.decision._tag !== 'Cancelled'
  ) {
    return Effect.succeed(result);
  }
  return Deferred.await(cancellation.cell).pipe(
    Effect.flatMap((ended) =>
      ended.receipt !== undefined
        ? Effect.succeed(withEnding(result, ended.receipt))
        : ended.attached === true
          ? stopping(road, operation, execution, declaredStop(cancellation.stop), cancellation.stop.stopped()?.message).pipe(
              Effect.map((again) => (again.receipt === undefined ? result : withEnding(result, again.receipt))),
            )
          : Effect.succeed(result),
    ),
  );
};

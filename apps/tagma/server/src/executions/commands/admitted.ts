import { Effect } from 'effect';
import { ByteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { HostRequestKey, type ExecutionRef, type Purpose } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { StdinPolicy } from '@runlith/executions/protocol/launch';
import type { CommandCreator } from '../contract/wire/commands.js';
import type { CommandSubject } from '../contract/wire/commandSubject.js';
import type { TerminalActor } from '../contract/wire/terminals.js';
import { principalOf } from '../terminals/principals.js';
import { terminalRefusal } from '../terminals/refusal.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { TargetKey } from '../contract/wire/targets.js';
import type { TargetScope } from '../contract/service/targets.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { TerminalFailure, Terminals } from '../contract/service/terminals.js';

export type AdmittedCommand = {
  readonly terminals: Terminals['Service'];
  readonly commands: ManagedCommands['Service'];
  readonly access: CommandAccess['Service'];
  readonly targets: TargetScope;
  readonly projectId: number;
  readonly actor: TerminalActor;
  readonly owner: CommandSubject;
  readonly creator: CommandCreator;
  readonly tool: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly policyRoot?: string;
  readonly operation: HostRequestKey;
  readonly subject: string;
  readonly bytes: number;
  readonly environment?: CommandEnvironmentRequest;
  readonly started?: (execution: ExecutionRef) => Effect.Effect<void, { readonly message: string }>;
  readonly stdin?: StdinPolicy;
  readonly purpose?: Purpose;
  readonly requested?: number;
};

export type CommandSaid = { readonly text: string; readonly gap: boolean };

export type AdmittedEnding =
  | {
      readonly _tag: 'Ended';
      readonly execution: ExecutionRef;
      readonly exitCode: number;
      readonly stdout: CommandSaid;
      readonly stderr: CommandSaid;
    }
  | {
      readonly _tag: 'Unread';
      readonly execution: ExecutionRef;
      readonly said: string;
      readonly cancelled?: CancellationCause;
      readonly stdout: CommandSaid;
      readonly stderr: CommandSaid;
    }
  | { readonly _tag: 'Unwatched'; readonly execution: ExecutionRef; readonly said: string }
  | { readonly _tag: 'Unproved'; readonly said: string }
  | { readonly _tag: 'Refused'; readonly said: string; readonly refusal: TerminalRefused }
  | { readonly _tag: 'Unrun'; readonly said: string };

export const refusedAs = (failure: TerminalFailure): string => {
  const gate = terminalRefusal(failure);
  return `${gate.code}: ${gate.reason} — ${gate.unblock.join('; ')}`;
};

export type AdmittedWatch = Pick<AdmittedCommand, 'commands' | 'access' | 'projectId' | 'actor' | 'subject' | 'bytes'>;

export const admittedCommand = Effect.fnUntraced(function* (input: AdmittedCommand): Effect.fn.Return<AdmittedEnding> {
  const admitted = yield* Effect.result(admit(input));
  if (admitted._tag === 'Failure') return admitted.failure;
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const started = yield* Effect.result(start(input, admitted.success));
      if (started._tag === 'Failure') return started.failure;
      const { execution, waitMs, targetKey } = started.success;
      return yield* restore(
        Effect.gen(function* () {
          if (input.started !== undefined) {
            const recorded = yield* Effect.result(input.started(execution));
            if (recorded._tag === 'Failure')
              return {
                _tag: 'Unwatched',
                execution,
                said: `${input.subject} started but could not be recorded: ${recorded.failure.message}`,
              } satisfies AdmittedEnding;
          }
          return yield* admittedWatch(input, execution, waitMs);
        }),
      ).pipe(Effect.onInterrupt(() => halted(input, execution, targetKey)));
    }),
  );
});

const halted = Effect.fnUntraced(
  function* (input: AdmittedCommand, execution: ExecutionRef, targetKey: TargetKey) {
    const prepared = yield* input.access.prepare({ _tag: 'Stop', actor: input.actor, scope: input.projectId, execution });
    const { request } = prepared;
    if (request._tag !== 'Stop') return;
    yield* input.commands.stop(
      input.projectId,
      {
        projectId: input.projectId,
        operationId: HostRequestKey.make(`${input.operation}-halt`),
        requester: principalOf(input.actor),
        mutation: 'stop',
        targetKey,
        execution,
      },
      execution,
      { prepared: { ...prepared, request }, recheck: (unit) => input.access.recheck(unit, prepared) },
      'run-abort',
      'destroy',
    );
  },
  (effect, input) =>
    Effect.flatMap(Effect.result(effect), (result) =>
      result._tag === 'Success'
        ? Effect.void
        : Effect.logWarning(`${input.subject} was interrupted and could not be stopped`, { reason: String(result.failure) }),
    ),
);

export const admittedWatch = Effect.fnUntraced(function* (
  input: AdmittedWatch,
  execution: ExecutionRef,
  waitMs: number = WAIT_SLICE_MS,
): Effect.fn.Return<AdmittedEnding> {
  const decided = yield* Effect.result(decide(input, execution, waitMs));
  if (decided._tag === 'Failure') {
    return {
      _tag: 'Unwatched',
      execution,
      said: `${decided.failure} (execution ${execution.execution}, incarnation ${execution.incarnation})`,
    };
  }
  const stdoutEnd = endOf(decided.success, 'stdout');
  const stderrEnd = endOf(decided.success, 'stderr');
  const said = yield* Effect.result(
    stdoutEnd === 0n && stderrEnd === 0n
      ? Effect.succeed<readonly [CommandSaid, CommandSaid]>([SILENT, SILENT])
      : Effect.flatMap(observing(input, execution), (authority): Effect.Effect<readonly [CommandSaid, CommandSaid], TerminalFailure> =>
          authority === undefined
            ? Effect.succeed([UNREAD, UNREAD])
            : Effect.all(
                [consoleOf(input, execution, 'stdout', authority, stdoutEnd), consoleOf(input, execution, 'stderr', authority, stderrEnd)],
                { concurrency: 2 },
              ),
        ),
  );
  const ending = endingOf(input, decided.success);
  if (said._tag === 'Failure') {
    const lost = `its console could not be read: ${refusedAs(said.failure)}`;
    return {
      _tag: 'Unread',
      execution,
      said: 'unread' in ending ? `${ending.unread}; ${lost}` : `${input.subject} exited ${ending.exitCode}, but ${lost}`,
      cancelled: 'unread' in ending ? ending.cancelled : undefined,
      stdout: UNREAD,
      stderr: UNREAD,
    };
  }
  const [stdout, stderr] = said.success;
  return 'unread' in ending
    ? {
        _tag: 'Unread',
        execution,
        said: ending.unread,
        cancelled: ending.cancelled,
        stdout,
        stderr,
      }
    : { _tag: 'Ended', execution, exitCode: ending.exitCode, stdout, stderr };
});

const endingOf = (
  input: AdmittedWatch,
  summary: ExecutionSummary,
): { readonly exitCode: number } | { readonly unread: string; readonly cancelled?: CancellationCause } => {
  const decision = summary.decision;
  if (decision !== undefined && decision._tag === 'Cancelled') {
    return { unread: `${input.subject} was cancelled (${decision.cause}: ${decision.trigger})`, cancelled: decision.cause };
  }
  const exit = summary.state.nativeExit;
  if (exit === undefined) return { unread: `${input.subject} ended and the host watched no exit for it` };
  if (exit._tag === 'Signal') return { unread: `${input.subject} was ended by ${exit.signal} rather than exiting` };
  return { exitCode: exit.code };
};

type Unstarted = Extract<AdmittedEnding, { readonly _tag: 'Refused' | 'Unrun' | 'Unproved' }>;

const unrun = (said: string): Unstarted => ({ _tag: 'Unrun', said });

const refused = (input: AdmittedCommand, step: string, refusal: TerminalRefused): Unstarted => ({
  _tag: 'Refused',
  said: `${input.subject} ${step}: ${refusedAs(refusal)}`,
  refusal,
});

const unstartedBy =
  (input: AdmittedCommand, step: string) =>
  (failure: TerminalFailure): Unstarted =>
    failure instanceof TerminalRefused ? refused(input, step, failure) : unrun(`${input.subject} ${step}: ${refusedAs(failure)}`);

const admit = Effect.fn('admittedCommand.admit')(function* (input: AdmittedCommand) {
  const target = yield* input.targets
    .resolve({ projectId: input.projectId, kind: 'host', cwd: input.cwd })
    .pipe(Effect.mapError(unstartedBy(input, 'could not be placed where it runs')));
  const prepared = yield* input.access
    .prepare({
      _tag: 'Launch',
      actor: input.actor,
      scope: input.projectId,
      target,
      program: input.program,
      args: input.args,
      tool: input.tool,
      owner: input.owner,
      creator: input.creator,
      operation: input.operation,
      cwd: input.cwd,
      policyRoot: input.policyRoot,
      requested: input.requested,
    })
    .pipe(Effect.mapError(unstartedBy(input, 'was not admitted')));
  const { request, receipt } = prepared;
  if (request._tag !== 'Launch' || receipt === undefined) {
    return yield* Effect.fail(unrun(`${input.subject} prepared no launch of its own`));
  }
  return { target, launch: { ...prepared, request, receipt } };
});

type Admitted = Effect.Success<ReturnType<typeof admit>>;

const start = Effect.fn('admittedCommand.start')(function* (input: AdmittedCommand, { target, launch }: Admitted) {
  const started = yield* Effect.scoped(
    input.terminals.start({
      actor: input.actor,
      operationId: input.operation,
      target,
      targetKey: launch.targetKey,
      program: input.program,
      args: input.args,
      transport: 'pipes',
      stdin: input.stdin ?? 'ignore',
      lifetime: 'call',
      purpose: input.purpose ?? 'internal',
      environment: input.environment,
      command: { prepared: launch, recheck: (unit) => input.access.recheck(unit, launch) },
    }),
  ).pipe(Effect.mapError(unstartedBy(input, 'could not be started')));
  if (started._tag === 'Accepted') {
    return { execution: started.record.execution, waitMs: launch.receipt.limits.executionMs ?? WAIT_SLICE_MS, targetKey: launch.targetKey };
  }
  if (started._tag === 'Refused') {
    return yield* Effect.fail(refused(input, 'was refused', started.refusal));
  }
  if (started._tag === 'Uncertain') {
    return yield* Effect.fail<Unstarted>({
      _tag: 'Unproved',
      said: `${input.subject}'s start is unproved, so nothing may be concluded from it: ${input.operation}`,
    });
  }
  return yield* Effect.fail(unrun(`${input.subject} started as a terminal rather than as bounded work`));
});

const WAIT_SLICE_MS = 60_000;

const decide = Effect.fn('admittedCommand.decide')(function* (input: AdmittedWatch, execution: ExecutionRef, waitMs: number) {
  for (;;) {
    const prepared = yield* input.access
      .prepare({ _tag: 'Await', actor: input.actor, scope: input.projectId, execution })
      .pipe(Effect.mapError((refusal) => `${input.subject} could not be watched: ${refusedAs(refusal)}`));
    const { request } = prepared;
    if (request._tag !== 'Await') return yield* Effect.fail(`${input.subject} prepared no wait of its own`);
    const answer = yield* input.commands
      .wait(
        execution,
        {
          prepared: { ...prepared, request },
          recheck: (unit) => input.access.recheck(unit, prepared),
        },
        waitMs,
      )
      .pipe(Effect.mapError((failure) => `${input.subject} could not be watched: ${refusedAs(failure)}`));
    if (answer._tag === 'Decided') return answer.summary;
    if (answer._tag === 'Unwatchable') {
      return yield* Effect.fail(`the host holds nothing under ${input.subject}, so how it ended is unknown`);
    }
  }
});

const observing = Effect.fn('admittedCommand.observe')(function* (input: AdmittedWatch, execution: ExecutionRef) {
  const prepared = yield* input.access.prepare({
    _tag: 'Observe',
    actor: input.actor,
    scope: input.projectId,
    execution,
  });
  const { request } = prepared;
  if (request._tag !== 'Observe') return undefined;
  return {
    prepared: { ...prepared, request },
    recheck: (unit: Parameters<typeof input.access.recheck>[0]) => input.access.recheck(unit, prepared),
  };
});

type Observing = NonNullable<Effect.Success<ReturnType<typeof observing>>>;

const SILENT: CommandSaid = { text: '', gap: false };

const UNREAD: CommandSaid = { text: '', gap: true };

//! a settled summary is taken after each stream's record closed, so its eof position is the stream's whole length
const endOf = (summary: ExecutionSummary, stream: 'stdout' | 'stderr'): bigint | undefined => {
  const positions = summary.streams.find((one) => one.stream === stream);
  return positions === undefined || positions.ending !== 'eof' ? undefined : offsetValue(positions.durableThrough);
};

const consoleOf = Effect.fn('admittedCommand.console')(function* (
  input: AdmittedWatch,
  execution: ExecutionRef,
  stream: 'stdout' | 'stderr',
  authority: Observing,
  end: bigint | undefined,
) {
  if (end === 0n) return SILENT;
  let offset = ByteOffset.make('0');
  const decoder = new TextDecoder();
  let text = '';
  let taken = 0;
  let gap = false;
  for (;;) {
    const window = yield* input.commands.bytes({ ref: execution, stream, offset }, input.bytes - taken, authority);
    if (window.range.gap) gap = true;
    taken += window.bytes.length;
    text += decoder.decode(window.bytes, { stream: true });
    const whole = end !== undefined && offsetValue(window.range.next) >= end;
    if (whole || window.range.next === offset || taken >= input.bytes) {
      if (taken >= input.bytes && !whole && window.range.next !== offset) gap = true;
      return { text: text + decoder.decode(), gap };
    }
    offset = window.range.next;
  }
});

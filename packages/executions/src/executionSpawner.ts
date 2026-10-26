import { Cause, Context, Deferred, Effect, Option, Ref, Schema, Sink, Stream, SubscriptionRef } from 'effect';
import * as PlatformError from 'effect/PlatformError';
import type { Command, CommandOptions } from 'effect/process/ChildProcess';
import { ExitCode, make as makeSpawner, makeHandle, ProcessId } from 'effect/process/ChildProcessSpawner';
import type { CommandEnvironment } from './CommandEnvironment';
import { Executions, type ExecutionsFailure } from './Executions';
import { ExecutionFeed } from './ExecutionFeed';
import { ExecutionRequest } from './ExecutionRequest';
import { type ManagedCall, ManagedCallFailed, ManagedCallTypeId, withManagedCall } from './ManagedCall';
import type { CallBudget, CallDecisionAnswer, CallStopping, CancellationCause } from './protocol/call';
import type { BindingId, Principal } from './protocol/custody';
import {
  type EnvironmentEntry,
  type ExecutionRef,
  type ExecutionTargetRef,
  type InstallationId,
  type Lifetime,
  HostRequestKey,
  type HostRequestRef,
  type Purpose,
} from './protocol/execution';
import { type InputFrontier, type InputSequence } from './protocol/input';
import type { LaunchRequest, StdinPolicy } from './protocol/launch';
import { byteOffset, offsetValue, type Stream as RecordStream } from './protocol/record';
import type { ExecutionSummary } from './protocol/runtime';
import { TerminalInput } from './TerminalInput';

const readOperation = Schema.decodeUnknownSync(HostRequestKey);

export type SpawnContext = {
  readonly installation: InstallationId;
  readonly purpose: Purpose;
  readonly lifetime: 'call' | 'held';
  readonly correlation: string;
  readonly target: ExecutionTargetRef;
  readonly holder: Principal;
  readonly origin: Principal;
  readonly readerCredits: number;
  readonly budget?: CallBudget;
  readonly stop?: CallStopping;
};

export type SpawnObservation = {
  readonly execution: ExecutionRef;
  readonly operation: HostRequestRef;
  readonly command: LaunchRequest['command'];
};

export type CallAnnotation = {
  readonly purpose?: Purpose;
  readonly correlation?: string;
  readonly budget?: CallBudget;
  readonly stop?: CallStopping;
  readonly observed?: (spawn: SpawnObservation) => void;
};

export const SpawnAnnotation = Context.Reference<CallAnnotation | undefined>('@runlith/executions/SpawnAnnotation', {
  defaultValue: () => undefined,
});

const annotated = (bound: SpawnContext): Effect.Effect<SpawnContext> =>
  Effect.map(SpawnAnnotation, (note) =>
    note === undefined
      ? bound
      : {
          ...bound,
          purpose: note.purpose ?? bound.purpose,
          correlation: note.correlation ?? bound.correlation,
          budget: note.budget ?? bound.budget,
          stop: note.stop ?? bound.stop,
        },
  );

const refuse = (method: string, description: string, cause?: unknown): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(
    PlatformError.badArgument({
      module: 'executionSpawner',
      method,
      description,
      cause: cause,
    }),
  );

const failed = (failure: ManagedCallFailed): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(
    PlatformError.badArgument({
      module: 'executionSpawner',
      method: 'spawn',
      description: `${failure.operation.operation}: ${failure.reason} — ${failure.detail}`,
      cause: failure,
    }),
  );

const reporting = (observer: ((spawn: SpawnObservation) => void) | undefined, spawn: SpawnObservation): Effect.Effect<void> =>
  observer === undefined
    ? Effect.void
    : Effect.try({ try: () => observer(spawn), catch: (cause) => cause }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning(`spawn observer threw for execution ${spawn.execution.execution}; it stands unlinked`, cause),
        ),
      );

const signalled = (signal: string) =>
  PlatformError.systemError({
    _tag: 'Unknown',
    module: 'executionSpawner',
    method: 'exitCode',
    description: `Process interrupted due to receipt of signal: '${signal}'`,
  });

const unreachable = (method: string, failure: ExecutionsFailure, execution: ExecutionRef) =>
  PlatformError.systemError({
    _tag: 'Unknown',
    module: 'executionSpawner',
    method,
    description: `execution ${execution.execution}:${execution.incarnation} ${method}: ${failure._tag}${failure._tag === 'HostRefused' ? ` ${failure.refusal._tag}: ${failure.refusal.reason}` : ''}`,
    cause: failure,
  });

const requested = (options: CommandOptions) => {
  const entries: Array<EnvironmentEntry> = [];
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (name.length === 0) continue;
    entries.push(value === undefined ? { _tag: 'Unset', name } : { _tag: 'Set', name, value });
  }
  return { inherit: options.env === undefined || options.extendEnv === true, entries };
};

const streamOption = (option: CommandOptions['stdin'] | CommandOptions['stdout']): unknown =>
  option !== undefined && typeof option === 'object' ? ('stream' in option ? option.stream : undefined) : option;

const stdinPolicy = (options: CommandOptions): StdinPolicy | undefined => {
  const stream = streamOption(options.stdin);
  if (stream === undefined || stream === 'pipe') return 'pipe';
  if (stream === 'ignore') return 'ignore';
  return undefined;
};

type OutputPolicy = 'read' | 'dropped';

const outputPolicy = (option: CommandOptions['stdout']): OutputPolicy | undefined => {
  const stream = streamOption(option);
  if (stream === undefined || stream === 'pipe' || stream === 'overlapped') return 'read';
  if (stream === 'ignore') return 'dropped';
  return undefined;
};

type Watch = {
  readonly latest: SubscriptionRef.SubscriptionRef<ExecutionSummary | undefined>;
  readonly over: Deferred.Deferred<string>;
};

export const executionSpawner = Effect.fnUntraced(function* (environment: CommandEnvironment, bound: SpawnContext) {
  const executions = yield* Executions;
  const { subscribe } = yield* ExecutionFeed;
  const requests = yield* ExecutionRequest;
  const inputs = yield* TerminalInput;

  const watch = Effect.fnUntraced(function* (execution: ExecutionRef, credits: number) {
    const latest = yield* SubscriptionRef.make<ExecutionSummary | undefined>(undefined);
    const over = yield* Deferred.make<string>();
    yield* Effect.forkScoped(
      Stream.runForEach(subscribe({ _tag: 'State', execution }, credits), (delivery) =>
        delivery._tag === 'State'
          ? SubscriptionRef.set(latest, delivery.summary)
          : delivery._tag === 'Ended'
            ? Deferred.succeed(over, `the state subscription ended: ${delivery.ending}`)
            : Effect.void,
      ).pipe(
        Effect.matchEffect({
          onFailure: (failure) => Deferred.succeed(over, `the state subscription failed: ${failure._tag}`),
          onSuccess: () => Deferred.succeed(over, 'the state subscription ended'),
        }),
      ),
    );
    return { latest, over };
  });

  const settled = (
    operation: HostRequestRef,
    held: Watch,
  ): Effect.Effect<CallDecisionAnswer, ExecutionsFailure | PlatformError.PlatformError> =>
    until(held, 'result', (summary) => summary.decision).pipe(
      Effect.andThen(requests.callResult(operation)),
      Effect.map((answer): CallDecisionAnswer =>
        answer._tag === 'Settled'
          ? answer.result
          : {
              _tag: 'Unavailable',
              operation,
              execution: answer.execution,
              reason: 'the host records a decision it cannot yet answer with',
            },
      ),
    );

  const output = (
    execution: ExecutionRef,
    stream: RecordStream,
    policy: OutputPolicy,
    credits: number,
  ): Stream.Stream<Uint8Array, PlatformError.PlatformError> =>
    policy === 'dropped'
      ? Stream.empty
      : subscribe({ _tag: 'Bytes', cursor: { ref: execution, stream, offset: byteOffset(0n) } }, credits).pipe(
          Stream.mapError((failure) => unreachable(`${stream}`, failure, execution)),
          Stream.mapEffect((delivery): Effect.Effect<Uint8Array | undefined, PlatformError.PlatformError> =>
            delivery._tag === 'Bytes'
              ? Effect.succeed(delivery.bytes)
              : delivery._tag !== 'Ended' || delivery.ending === 'completed' || delivery.ending === 'cancelled'
                ? Effect.succeed(undefined)
                : Effect.fail(
                    PlatformError.systemError({
                      _tag: 'BadResource',
                      module: 'executionSpawner',
                      method: `${stream}`,
                      description: `execution ${execution.execution}:${execution.incarnation} ${stream}: ${delivery.ending === 'gap' ? 'output exceeded the retained record; read the retained bytes under this execution reference' : `the record stopped answering: ${delivery.ending}`}`,
                      cause: { execution, stream, ending: delivery.ending },
                    }),
                  ),
          ),
          Stream.filter((chunk): chunk is Uint8Array => chunk !== undefined),
        );

  const end = Effect.fnUntraced(function* (context: SpawnContext, execution: ExecutionRef, input: InputLane) {
    const next = (yield* Ref.getAndUpdate(input.sequence, (held) => held + 1)) as InputSequence;
    const outcome = yield* inputs
      .input(execution, { binding: input.binding, principal: context.holder }, { sequence: next, cause: 'end', act: { _tag: 'End' } })
      .pipe(Effect.mapError((failure) => unreachable('stdin', failure, execution)));
    if (outcome._tag === 'InputAdmitted' || outcome._tag === 'InputEnded') return;
    return yield* Effect.fail(
      PlatformError.systemError({
        _tag: 'BadResource',
        module: 'executionSpawner',
        method: 'stdin',
        description: `the end of input was not admitted: ${outcome._tag}`,
        cause: outcome,
      }),
    );
  });

  const admit = Effect.fnUntraced(function* (
    context: SpawnContext,
    execution: ExecutionRef,
    held: Watch,
    input: InputLane,
    chunk: Uint8Array,
  ): Effect.fn.Return<void, PlatformError.PlatformError> {
    const next = (yield* Ref.getAndUpdate(input.sequence, (held) => held + 1)) as InputSequence;
    const outcome = yield* inputs
      .input(
        execution,
        { binding: input.binding, principal: context.holder },
        { sequence: next, cause: 'raw', act: { _tag: 'Write', bytes: chunk } },
      )
      .pipe(Effect.mapError((failure) => unreachable('stdin', failure, execution)));
    if (outcome._tag === 'InputAdmitted') return;
    if (outcome._tag === 'InputBackpressure') {
      yield* Ref.set(input.sequence, next);
      if (chunk.length > outcome.limit) {
        yield* Ref.set(input.widest, outcome.limit);
        return yield* Effect.forEach(pieces(chunk, outcome.limit), (piece) => admit(context, execution, held, input, piece), {
          discard: true,
        });
      }
      yield* room(held, outcome.frontier, outcome.limit - chunk.length);
      return yield* admit(context, execution, held, input, chunk);
    }
    return yield* Effect.fail(
      PlatformError.systemError({
        _tag: 'BadResource',
        module: 'executionSpawner',
        method: 'stdin',
        description: `input was not admitted: ${outcome._tag}`,
        cause: outcome,
      }),
    );
  });

  const writer = (
    context: SpawnContext,
    execution: ExecutionRef,
    held: Watch,
    input: InputLane,
    endOnDone: boolean,
  ): Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError> => {
    const written = Sink.forEach((chunk: Uint8Array) =>
      chunk.length === 0
        ? Effect.void
        : Effect.flatMap(Ref.get(input.widest), (widest) =>
            Effect.forEach(pieces(chunk, widest), (piece) => admit(context, execution, held, input, piece), {
              discard: true,
            }),
          ),
    );
    return endOnDone ? Sink.mapEffect(written, () => end(context, execution, input)) : written;
  };

  const spawn = Effect.fn('executions.spawn')(function* (command: Command) {
    const context = yield* annotated(bound);
    const observer = yield* Effect.map(SpawnAnnotation, (note) => note?.observed);
    if (command._tag !== 'StandardCommand') {
      return yield* refuse('spawn', 'a piped command is not one managed execution');
    }
    const options = command.options;
    if (options.additionalFds !== undefined && Object.keys(options.additionalFds).length > 0) {
      return yield* refuse('spawn', 'additional file descriptors are not supported by a managed execution');
    }
    if (options.shell !== undefined && options.shell !== false) {
      return yield* refuse('spawn', 'a shell command must name its shell as the program it runs');
    }
    const stdoutPolicy = outputPolicy(options.stdout);
    const stderrPolicy = outputPolicy(options.stderr);
    if (stdoutPolicy === undefined || stderrPolicy === undefined) {
      return yield* refuse(
        'spawn',
        'a managed execution reads its output over the wire or drops it: an output sink and inherit are not arrangements it can make',
      );
    }
    if (options.detached === false) {
      return yield* refuse('spawn', 'detached: false asks for a child bound to this process; a managed execution belongs to its host');
    }
    if (options.windowsHide !== undefined) {
      return yield* refuse('spawn', 'windowsHide is a property of a child of this process; a managed execution is not one');
    }
    const stdinConfig = options.stdin;
    const endOnDone =
      stdinConfig !== undefined && typeof stdinConfig === 'object' && 'stream' in stdinConfig ? stdinConfig.endOnDone !== false : true;
    if (stdinConfig !== undefined && typeof stdinConfig === 'object' && 'stream' in stdinConfig) {
      if (stdinConfig.encoding !== undefined) {
        return yield* refuse('spawn', 'stdin encoding is not supported by a managed execution');
      }
    }
    const stdin = stdinPolicy(options);
    if (stdin === undefined) {
      return yield* refuse(
        'spawn',
        'a managed execution takes a piped or absent stdin: a stdin stream, and inheriting the stdin of this process, are not arrangements it can make',
      );
    }

    const operation: HostRequestRef = {
      installation: context.installation,
      operation: readOperation(`${context.correlation}:${yield* Effect.sync(() => crypto.randomUUID())}`),
    };

    if (context.stop !== undefined && context.stop.stopped() !== null) {
      return yield* failed(new ManagedCallFailed({ operation, reason: 'cancelled', detail: 'the run was aborted before dispatch' }));
    }

    const effective = yield* environment
      .materialize(requested(options))
      .pipe(
        Effect.catchTag('CommandEnvironmentUnavailable', (error) =>
          refuse('spawn', `the bound environment could not be read: ${error.reason}`, error),
        ),
      );

    const launch: LaunchRequest = {
      command: {
        program: command.command,
        args: command.args,
        environment: effective,
        cwd: options.cwd,
      },
      transport: {
        _tag: 'pipes',
        stdin,
        streaming: [...(stdoutPolicy === 'read' ? ['stdout' as const] : []), ...(stderrPolicy === 'read' ? ['stderr' as const] : [])],
      },
      lifetime: context.lifetime,
      purpose: context.purpose,
      target: context.target,
      holder: context.holder,
      origin: context.origin,
      budget: context.budget,
    };

    const unconfirmed = () =>
      requests.operation(operation).pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            failed(
              new ManagedCallFailed({
                operation,
                reason: 'uncertain',
                detail: `the start could not be confirmed: ${failure._tag}`,
              }),
            ),
          onSuccess: (answer) =>
            failed(
              new ManagedCallFailed({
                operation,
                execution: answer._tag === 'Accepted' && answer.execution !== undefined ? answer.execution : undefined,
                reason: answer._tag === 'Cancelled' ? 'cancelled' : answer._tag === 'Refused' ? 'refused' : 'uncertain',
                detail: `the reply was lost; the key answers ${answer._tag}`,
              }),
            ),
        }),
      );
    const outcome = yield* executions.start(operation, launch).pipe(
      Effect.catchTags({
        HostRefused: (failure) =>
          failed(
            new ManagedCallFailed({
              operation,
              reason: 'refused',
              detail: `${failure.refusal._tag}: ${failure.refusal.reason}`,
            }),
          ),
        WireFailed: (failure) =>
          failed(
            new ManagedCallFailed({
              operation,
              reason: 'refused',
              detail: `${failure.fault.kind}: ${failure.fault.detail}`,
            }),
          ),
        WireLost: (failure) =>
          !failure.sent ? failed(new ManagedCallFailed({ operation, reason: 'unavailable', detail: failure.reason })) : unconfirmed(),
        WireUnavailable: (failure) =>
          !failure.sent ? failed(new ManagedCallFailed({ operation, reason: 'unavailable', detail: failure.reason })) : unconfirmed(),
        WireInvalid: unconfirmed,
        WireUnreadable: unconfirmed,
      }),
    );

    if (outcome._tag === 'Cancelled') {
      return yield* failed(
        new ManagedCallFailed({ operation, reason: 'cancelled', detail: 'a cancellation of this key won before the spawn' }),
      );
    }
    if (outcome._tag === 'Refused') {
      return yield* failed(
        new ManagedCallFailed({
          operation,
          reason: 'refused',
          detail: `${outcome.refusal._tag}: ${outcome.refusal.reason}`,
        }),
      );
    }
    if (outcome._tag === 'Uncertain') {
      const effect = outcome.effect;
      return yield* failed(
        new ManagedCallFailed({
          operation,
          execution: effect._tag !== 'InFlight' && effect.execution !== undefined ? effect.execution : undefined,
          reason: 'uncertain',
          detail: effect._tag,
        }),
      );
    }

    if (outcome._tag === 'Accepted') {
      return yield* failed(
        new ManagedCallFailed({
          operation,
          execution: outcome.execution,
          reason: 'unavailable',
          detail: 'the host accepted this launch as bounded work instead of acquiring a child for it',
        }),
      );
    }

    const execution = outcome.execution;
    const pid = outcome.native.pid;
    if (pid === undefined) {
      return yield* failed(
        new ManagedCallFailed({
          operation,
          execution,
          reason: 'unavailable',
          detail: 'the host started this execution without reporting a native identity',
        }),
      );
    }

    yield* reporting(observer, { execution, operation, command: launch.command });

    const held = yield* watch(execution, context.readerCredits);
    const sequence = yield* Ref.make(0);
    const widest = yield* Ref.make<number | undefined>(undefined);

    const stopKey: HostRequestRef = {
      installation: operation.installation,
      operation: readOperation(`${operation.operation}:stop`),
    };
    const request = (cause: CancellationCause) => executions.stop(stopKey, execution, cause, 'signal');

    if (context.stop !== undefined) {
      yield* Effect.forkScoped(
        Effect.flatMap(context.stop.stopping, (said) =>
          Effect.flatMap(Effect.exit(request(said.reason)), (asked) =>
            asked._tag === 'Success'
              ? Effect.void
              : Effect.logWarning('the stop a call asked for did not reach its execution; its scope ends it on close', {
                  execution: execution.execution,
                  cause: Cause.pretty(asked.cause),
                }),
          ),
        ),
      );
    }
    const retireKey: HostRequestRef = {
      installation: operation.installation,
      operation: readOperation(`${operation.operation}:retire`),
    };
    yield* Effect.addFinalizer(() => {
      const cause: CancellationCause = context.stop?.stopped()?.reason ?? 'scope-closed';
      return Effect.ignore(request(cause).pipe(Effect.andThen(executions.retire(retireKey, execution))));
    });
    const lane =
      stdin === 'ignore'
        ? undefined
        : yield* inputs.openBinding(context.holder, execution).pipe(
            Effect.mapError((failure) => unreachable('stdin', failure, execution)),
            Effect.flatMap((answer) =>
              answer._tag === 'Bound'
                ? Effect.succeed(answer.binding)
                : refuse('stdin', `the host did not open this child’s input lane: ${answer._tag}`),
            ),
          );
    if (lane !== undefined) {
      yield* Effect.addFinalizer(() => Effect.asVoid(inputs.closeBinding(lane, context.holder)).pipe(Effect.ignore));
    }

    const handle = makeHandle({
      pid: ProcessId(pid),
      exitCode: until(held, 'exitCode', (summary) => summary.state.nativeExit).pipe(
        Effect.flatMap((exit) => (exit._tag === 'Code' ? Effect.succeed(ExitCode(exit.code)) : Effect.fail(signalled(exit.signal)))),
      ),
      isRunning: executions.state(execution).pipe(
        Effect.map((summary) => summary !== undefined && summary.state.phase !== 'ended'),
        Effect.mapError((failure) => unreachable('isRunning', failure, execution)),
      ),
      kill: () =>
        request('explicit-stop').pipe(
          Effect.mapError((failure) => unreachable('kill', failure, execution)),
          Effect.flatMap((receipt) =>
            receipt.cleanup === 'complete'
              ? Effect.asVoid(until(held, 'kill', (summary) => summary.state.nativeExit))
              : Effect.fail(
                  PlatformError.systemError({
                    _tag: 'Unknown',
                    module: 'executionSpawner',
                    method: 'kill',
                    description: `the stop did not confirm the child ended: cleanup ${receipt.cleanup}`,
                    cause: receipt,
                  }),
                ),
          ),
        ),
      stdin: lane === undefined ? Sink.drain : writer(context, execution, held, { binding: lane, sequence, widest }, endOnDone),
      stdout: output(execution, 'stdout', stdoutPolicy, context.readerCredits),
      stderr: output(execution, 'stderr', stderrPolicy, context.readerCredits),
      all: Stream.merge(
        output(execution, 'stdout', stdoutPolicy, context.readerCredits),
        output(execution, 'stderr', stderrPolicy, context.readerCredits),
      ),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });

    const companion: ManagedCall = {
      [ManagedCallTypeId]: ManagedCallTypeId,
      operation,
      execution,
      deadline: outcome.deadline,
      result: settled(operation, held),
      cancel: (cause, trigger) =>
        Effect.asVoid(request(cause).pipe(Effect.tap(() => Effect.logDebug(`managed call ${operation.operation} cancelled: ${trigger}`)))),
    };
    return withManagedCall(handle, companion);
  });

  return makeSpawner(spawn);
});

type InputLane = {
  readonly binding: BindingId;
  readonly sequence: Ref.Ref<number>;
  readonly widest: Ref.Ref<number | undefined>;
};

const pieces = (chunk: Uint8Array, widest: number | undefined): readonly Uint8Array[] => {
  if (widest === undefined || chunk.length <= widest) return [chunk];
  const cut: Uint8Array[] = [];
  for (let at = 0; at < chunk.length; at += widest) cut.push(chunk.subarray(at, at + widest));
  return cut;
};

const until = <A>(
  held: Watch,
  what: string,
  read: (summary: ExecutionSummary) => A | undefined,
): Effect.Effect<A, PlatformError.PlatformError> => {
  const lost = Deferred.await(held.over).pipe(
    Effect.flatMap((reason) =>
      Effect.fail(
        PlatformError.systemError({
          _tag: 'BadResource',
          module: 'executionSpawner',
          method: what,
          description: `${reason}, before ${what} could be observed`,
        }),
      ),
    ),
  );
  const arriving = SubscriptionRef.changes(held.latest).pipe(
    Stream.filter((summary): summary is ExecutionSummary => summary !== undefined),
    Stream.map(read),
    Stream.filter((value): value is A => value !== undefined),
    Stream.runHead,
    Effect.flatMap(Option.match({ onNone: () => lost, onSome: (value: A) => Effect.succeed(value) })),
  );
  return Effect.flatMap(SubscriptionRef.get(held.latest), (summary) => {
    const standing = summary === undefined ? undefined : read(summary);
    if (standing !== undefined) return Effect.succeed(standing);
    return Effect.raceFirst(arriving, lost);
  });
};

const room = (held: Watch, refused: InputFrontier, owed: number) =>
  until(held, 'stdin', (summary) =>
    summary.state.phase === 'ended' ||
    (offsetValue(summary.input.acceptedThrough) >= offsetValue(refused.acceptedThrough) && summary.input.pendingBytes <= owed)
      ? true
      : undefined,
  );

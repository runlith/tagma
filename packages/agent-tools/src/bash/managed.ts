import * as path from 'node:path';
import { Deferred, Duration, Effect } from 'effect';
import { Tool, ToolFailed, type ToolEffectSettlement } from '@runlith/agent/tool';
import type { CallAuthority, CallControlResult, CallMove } from '@runlith/agent/callProgress';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CallStopping } from '@runlith/executions/protocol/call';
import { localRunning, observerLost, ShellRun, type ShellSettlement } from '../ShellRun';
import type { CommandAcceptance, CommandRun, CommandUnreadable, CommandWork } from '../CommandWork';
import type { CheckoutBaselines } from '../CheckoutBaselines';
import type { ResolvedToolOptions } from '../workspace';
import {
  awayAnswer,
  commandLabel,
  finishedAnswer,
  finishedElsewhere,
  measurement,
  noticedAnswer,
  ownerEnded,
  refusedAnswer,
  runningAnswer,
  strandedAnswer,
  type HandoffPhase,
  type Retained,
  type ShellServices,
} from './answers';
import { commandTime, preflight } from './preflight';
import { shellFacts } from '../shellFacts';
import type { Params } from './tool';

export const admitted = Effect.fn('BashTool.admitted')(function* (
  resolved: ResolvedToolOptions,
  work: CommandWork,
  services: ShellServices,
  params: Params,
  ctx: Tool.ToolCallOptions,
  baselines: CheckoutBaselines,
  retained: Map<string, Retained>,
) {
  const stop = ctx.progress;
  const ready = yield* preflight(resolved, params, baselines);
  const time = yield* commandTime(resolved, params, ctx.caller, ready.workdir);
  const shell = new ShellRun(resolved, baselines, services, ready.workdir, params.command, ctx.progress, ctx);
  yield* shell.open(ready).pipe(Effect.uninterruptible);
  shell.opened();
  ctx.progress?.stage('Admitting the command to its execution host');
  const operation = HostRequestKey.make(`${ctx.toolCallId}:${crypto.randomUUID()}`);
  const started = yield* Effect.result(
    work
      .start(
        {
          operation,
          program: resolved.world.environment.shell,
          args: ['-c', params.command],
          cwd: ready.workdir,
          label: commandLabel(params),
          env: shell.env,
          lifeMs: params.lifeMs,
          waitMs: time.wait.ms,
          correlation: ctx.toolCallId,
          stop,
        },
        (run) => reported(run, shell.observe(run), shell.elsewhere),
      )
      .pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            retained.set(ctx.toolCallId, { kind: 'uncertain', params, operation });
            shell.close();
          }),
        ),
      ),
  );
  if (started._tag === 'Failure') {
    const refusal = started.failure;
    if (refusal.certainty === 'unsubmitted') shell.forget();
    else shell.close();
    if (refusal.certainty === 'unsubmitted') {
      retained.set(ctx.toolCallId, { kind: 'unsubmitted' });
      return refusedAnswer(params, `This command was not admitted, and nothing ran: ${refusal.reason}`);
    }
    const where = refusal.execution === undefined ? '' : ` Execution ${refusal.execution.execution}:${refusal.execution.incarnation}.`;
    const key = refusal.operation?.operation ?? operation;
    return yield* new ToolFailed({
      reason: `Whether this command started is not known: ${refusal.reason}. Operation ${key}.${where} It was not submitted again — call read_terminal_operation with operationId ${key}; an unavailable reading is not proof nothing ran.`,
    });
  }
  const acceptance = started.success;
  const custody = new EndingCustody(acceptance.run);
  const phase = () => custody.phase;
  retained.set(ctx.toolCallId, { kind: 'admitted', params, time, acceptance, phase, waited: false });
  ctx.progress?.stage('The command is running');
  const away = custody.away;
  const unlink = ctx.progress?.link(
    {
      execution: acceptance.run.execution,
      operation: acceptance.run.operation,
      kind: 'command',
      label: commandLabel(params),
    },
    {
      revise: (remainingMs, authority) => deadlineAnswer(acceptance.run, remainingMs, authority),
      background: custody.background,
      handed: custody.handed,
    },
  );
  if (time.wait.ms === 0) {
    const phase = yield* Effect.result(acceptance.run.phase);
    if (phase._tag === 'Success' && phase.success === 'ended') {
      const ended = yield* Effect.result(acceptance.observed);
      unlink?.();
      return yield* finishedElsewhere(
        params,
        shell.elsewhere,
        ended._tag === 'Success' ? ended.success : observerLost(ended.failure.reason),
        acceptance.run,
      );
    }
    if (phase._tag === 'Failure') {
      return awayAnswer(params, acceptance.run, { phase: null, unreadable: phase.failure.reason });
    }
    return runningAnswer(params, acceptance.run, phase.success);
  }
  const handOff = Effect.gen(function* () {
    if (ctx.progress === undefined) {
      return { status: 'unavailable', detail: 'this call carries no way to the background' } satisfies CallControlResult;
    }
    retained.set(ctx.toolCallId, { kind: 'admitted', params, time, acceptance, phase, waited: true });
    const handed = yield* ctx.progress.handOff();
    if (handed.status !== 'changed') retained.set(ctx.toolCallId, { kind: 'admitted', params, time, acceptance, phase, waited: false });
    return handed;
  });
  const observed = yield* Effect.result(waited(acceptance, stop, unlink, time.wait.ms, handOff, away));
  const outcome = observed._tag === 'Success' ? observed.success : { answer: observerLost(observed.failure.reason), held: null };
  if (outcome === AWAY) return awayAnswer(params, acceptance.run, yield* custody.readPhase);
  const owner = yield* custody.keep;
  if (owner === 'notice') return awayAnswer(params, acceptance.run, yield* custody.readPhase);
  if (owner === 'noticed') return noticedAnswer(params, acceptance.run);
  const result = outcome.answer;
  const notes = [outcome.held, custody.kept].filter((note) => note !== null);
  return finishedAnswer(
    params,
    yield* ownerEnded(acceptance.run, result),
    shell.elsewhere,
    result,
    acceptance.run,
    notes.length === 0 ? null : notes.join('\n'),
  );
});

const RESTARTED = 'the process that held this call died while its command ran';

export const recovered = Effect.fn('BashTool.recovered')(function* (
  resolved: ResolvedToolOptions,
  work: CommandWork,
  services: ShellServices,
  params: Params,
  baselines: CheckoutBaselines,
  correlation: string,
): Effect.fn.Return<ToolEffectSettlement, ToolFailed> {
  const run = yield* work
    .startedBy(correlation)
    .pipe(Effect.mapError((failure) => new ToolFailed({ reason: `The command this call started could not be read back: ${failure.reason}` })));
  if (run === null) return { status: 'unknown' };
  const read = yield* Effect.result(run.phase);
  const phase: HandoffPhase = read._tag === 'Success' ? { phase: read.success, unreadable: null } : { phase: null, unreadable: read.failure.reason };
  if (phase.phase !== 'ended') {
    const moved = yield* Effect.result(run.background);
    if (moved._tag === 'Failure') return { status: 'completed', output: strandedAnswer(params, run, phase, moved.failure.reason) };
    if (moved.success === 'moved') return { status: 'completed', output: awayAnswer(params, run, phase) };
    if (moved.success === 'already') {
      return { status: 'completed', output: phase.phase === null ? awayAnswer(params, run, phase) : runningAnswer(params, run, phase.phase) };
    }
  }
  const workdir = params.workdir === undefined ? resolved.cwd : path.resolve(resolved.cwd, params.workdir);
  const shell = new ShellRun(resolved, baselines, services, workdir, params.command);
  yield* shell
    .open({ place: null, refused: RESTARTED, measuring: false, facts: shellFacts(params.command, workdir), elsewhere: null })
    .pipe(Effect.provide(services));
  const result = yield* shell.observe(run);
  return { status: 'completed', output: finishedAnswer(params, yield* ownerEnded(run, result), null, result, run) };
});

const MEASUREMENT_LOST = 'The checkout was not measured after this command: its observation ended before the measurement was taken.';

const reported = (run: CommandRun, observing: Effect.Effect<ShellSettlement>, elsewhere: string | null): Effect.Effect<ShellSettlement> =>
  observing.pipe(
    Effect.onExit((exit) =>
      run.measured(exit._tag === 'Success' ? measurement(exit.value, elsewhere) : MEASUREMENT_LOST).pipe(
        Effect.retry({ times: 2 }),
        Effect.result,
        Effect.flatMap((recorded) =>
          recorded._tag === 'Success'
            ? Effect.void
            : Effect.logWarning('the measurement of a command could not be recorded; its notice waits for the next boot', {
                execution: run.execution.execution,
                reason: recorded.failure.reason,
              }),
        ),
      ),
    ),
  );

class EndingCustody {
  readonly away = Deferred.makeUnsafe<void>();
  kept: string | null = null;
  phase: HandoffPhase = { phase: null, unreadable: null };
  private state: 'call' | 'moved' | 'away' | 'told' | 'kept' | 'noticed' = 'call';
  private moving: Deferred.Deferred<void> | null = null;

  constructor(private readonly run: CommandRun) {}

  readonly readPhase: Effect.Effect<HandoffPhase> = Effect.suspend(() =>
    this.run.phase.pipe(
      Effect.match({
        onFailure: (failure): HandoffPhase => ({ phase: null, unreadable: failure.reason }),
        onSuccess: (phase): HandoffPhase => ({ phase, unreadable: null }),
      }),
      Effect.tap((phase) =>
        Effect.sync(() => {
          this.phase = phase;
        }),
      ),
    ),
  );

  readonly background = (): Effect.Effect<CallMove> =>
    Effect.suspend(() => {
      if (this.state === 'moved' || this.state === 'away' || this.state === 'told') return Effect.succeed<CallMove>({ status: 'carried' });
      if (this.state !== 'call' || this.moving !== null) return Effect.succeed<CallMove>({ status: 'stays' });
      const moving = Deferred.makeUnsafe<void>();
      this.moving = moving;
      return Effect.result(this.run.background).pipe(
        Effect.flatMap((answer): Effect.Effect<CallMove> => {
          if (answer._tag === 'Failure') return Effect.succeed({ status: 'unavailable', detail: answer.failure.reason });
          return Effect.map(this.readPhase, () => {
            if (answer.success === 'already') return { status: 'carried' };
            if (answer.success !== 'moved') return { status: 'stays' };
            this.state = 'moved';
            return { status: 'carried' };
          });
        }),
        Effect.ensuring(
          Effect.suspend(() => {
            this.moving = null;
            return Deferred.succeed(moving, undefined);
          }),
        ),
      );
    });

  readonly handed = (done: boolean): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (this.state !== 'moved') return Effect.void;
      if (done) {
        this.state = 'away';
        return Deferred.succeed(this.away, undefined).pipe(Effect.asVoid);
      }
      this.state = 'call';
      return Effect.asVoid(this.withdraw);
    });

  readonly keep: Effect.Effect<'call' | 'notice' | 'noticed'> = Effect.suspend(() => {
    if (this.moving !== null) return Effect.andThen(Deferred.await(this.moving), this.keep);
    if (this.state === 'away' || this.state === 'moved') {
      this.state = 'told';
      return Effect.succeed('notice' as const);
    }
    if (this.state === 'noticed') return Effect.succeed('noticed' as const);
    this.state = 'kept';
    return Effect.succeed('call' as const);
  });

  private get withdraw(): Effect.Effect<void> {
    const moving = Deferred.makeUnsafe<void>();
    this.moving = moving;
    return Effect.result(this.run.foreground).pipe(
      Effect.map((back) => {
        if (back._tag === 'Failure') {
          this.kept = `Its ending may also arrive as a notice: the background it was moved to could not be withdrawn — ${back.failure.reason}.`;
        } else if (back.success === 'delivered') {
          this.state = 'noticed';
        }
      }),
      Effect.ensuring(
        Effect.suspend(() => {
          this.moving = null;
          return Deferred.succeed(moving, undefined);
        }),
      ),
    );
  }
}

const deadlineAnswer = (run: CommandRun, remainingMs: number, authority: CallAuthority): Effect.Effect<CallControlResult> =>
  run.revise(remainingMs, authority).pipe(
    Effect.map((revision): CallControlResult =>
      revision.state === 'revised'
        ? { status: 'changed', detail: null }
        : revision.state === 'stale'
          ? {
              status: 'unavailable',
              detail: 'The life of this command moved before the change was decided; read it again and ask over the figure it now holds.',
            }
          : revision.state === 'refused'
            ? { status: 'unavailable', detail: revision.reason }
            : { status: 'ended', detail: null },
    ),
    Effect.catchTag('CommandUnreadable', (failure) => Effect.succeed<CallControlResult>({ status: 'unavailable', detail: failure.reason })),
  );

const heldPast = (moved: CallControlResult): string | null =>
  moved.status === 'changed' || moved.status === 'ended'
    ? null
    : `Its wait passed and this call could not move it to the background${moved.detail === null ? '' : `: ${moved.detail}`}; it was held here until it ended.`;

const AWAY = 'away' as const;

const settledOrAway = <A>(
  acceptance: CommandAcceptance<A>,
  away: Deferred.Deferred<void>,
): Effect.Effect<A | typeof AWAY, CommandUnreadable> =>
  Effect.raceFirst<A | typeof AWAY, CommandUnreadable, never, typeof AWAY, never, never>(
    acceptance.observed,
    Effect.as(Deferred.await(away), AWAY),
  ).pipe(Effect.flatMap((first) => Effect.map(Deferred.isDone(away), (gone): A | typeof AWAY => (gone ? AWAY : first))));

const waited = Effect.fnUntraced(
  function* <A>(
    acceptance: CommandAcceptance<A>,
    stop: CallStopping | undefined,
    unlink: (() => void) | undefined,
    waitMs: number,
    handOff: Effect.Effect<CallControlResult>,
    away: Deferred.Deferred<void>,
  ): Effect.fn.Return<{ readonly answer: A; readonly held: string | null } | typeof AWAY, CommandUnreadable> {
    const early = yield* settledOrAway(acceptance, away).pipe(Effect.timeoutOption(Duration.millis(waitMs)));
    if (early._tag === 'Some') {
      if (early.value === AWAY) return AWAY;
      unlink?.();
      return { answer: early.value, held: null };
    }
    const moved = yield* handOff;
    const answer = yield* settledOrAway(acceptance, away);
    if (answer === AWAY) return AWAY;
    unlink?.();
    return { answer, held: heldPast(moved) };
  },
  (effect, acceptance, stop, unlink) =>
    Effect.onInterrupt(effect, () =>
      stop?.stopped() == null
        ? Effect.void
        : Effect.ensuring(
            Effect.result(acceptance.observed),
            Effect.sync(() => unlink?.()),
          ).pipe(Effect.asVoid, Effect.uninterruptible),
    ),
);

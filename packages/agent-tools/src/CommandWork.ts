import { Data, Effect, type Stream } from 'effect';
import { type CallAuthority, LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import type { ToolCaller } from '@runlith/agent/contracts';
import type { CallDecisionAnswer, CallStopping } from '@runlith/executions/protocol/call';
import type { LimitProvenance } from '@runlith/executions/protocol/command';
import type { ProcessRuling } from '@runlith/executions/protocol/stop';
import type { Cleanup, ExecutionRef, HostRequestKey, HostRequestRef } from '@runlith/executions/protocol/execution';

export const COMMAND_WAIT = { defaultMs: 2 * 60_000, ceilingMs: LONGEST_ACT_MS } as const;

export const COMMAND_LIFE = { defaultMs: 60 * 60_000, ceilingMs: 6 * 60 * 60_000 } as const;

export type CommandRequest = {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly label?: string;
  readonly lifeMs?: number;
  readonly waitMs: number;
  readonly correlation: string;
  readonly operation: HostRequestKey;
  readonly stop?: CallStopping;
};

export type CommandPhase = 'queued' | 'running' | 'ended';

export type RuledAnswer = CallDecisionAnswer & {
  readonly ruled?: { readonly rulings: ReadonlyArray<ProcessRuling>; readonly omitted: number };
};

export class CommandUnreadable extends Data.TaggedError('CommandUnreadable')<{
  readonly reason: string;
}> {}

export class CommandRefused extends Data.TaggedError('CommandRefused')<{
  readonly reason: string;
  readonly certainty: 'unsubmitted' | 'uncertain';
  readonly operation?: HostRequestRef;
  readonly execution?: ExecutionRef;
}> {}

export type CommandRunDeadline =
  | { readonly state: 'armed'; readonly timeoutMs: number; readonly origin: LimitProvenance }
  | { readonly state: 'unarmed'; readonly timeoutMs: number; readonly origin: LimitProvenance }
  | { readonly state: 'none' }
  | { readonly state: 'unreadable' };

export type CommandRevision =
  | { readonly state: 'revised'; readonly deadline: CommandRunDeadline }
  | { readonly state: 'stale'; readonly deadline: CommandRunDeadline }
  | { readonly state: 'refused'; readonly reason: string }
  | { readonly state: 'ended' };

export type CommandRun = {
  readonly operation: HostRequestRef;
  readonly execution: ExecutionRef;
  readonly deadline: CommandRunDeadline;
  readonly standing: Effect.Effect<CommandRunDeadline>;
  readonly rule?: string;
  readonly inspect: string;
  readonly phase: Effect.Effect<CommandPhase, CommandUnreadable>;
  readonly result: Effect.Effect<RuledAnswer, CommandUnreadable>;
  readonly revise: (remainingMs: number, authority: CallAuthority) => Effect.Effect<CommandRevision, CommandUnreadable>;
  readonly background: Effect.Effect<'moved' | 'already' | 'ended', CommandUnreadable>;
  readonly foreground: Effect.Effect<'withdrawn' | 'delivered', CommandUnreadable>;
  readonly measured: (words: string) => Effect.Effect<void, CommandUnreadable>;
  readonly stdout: Stream.Stream<Uint8Array, CommandUnreadable>;
  readonly stderr: Stream.Stream<Uint8Array, CommandUnreadable>;
};

export type CommandObservation<A> = (run: CommandRun) => Effect.Effect<A>;

export type CommandAcceptance<A> = {
  readonly run: CommandRun;
  readonly observed: Effect.Effect<A, CommandUnreadable>;
};

export type CommandWork = {
  readonly start: <A>(request: CommandRequest, observe: CommandObservation<A>) => Effect.Effect<CommandAcceptance<A>, CommandRefused>;
};

export type CommandLimit = {
  readonly ms: number;
  readonly origin: LimitProvenance;
  readonly rule: string | null;
};

export type CommandTime = { readonly wait: CommandLimit; readonly life: CommandLimit };

export type CommandAsk = { readonly waitMs?: number | undefined; readonly lifeMs?: number | undefined };

export type CommandTimes = {
  readonly resolve: (asked: CommandAsk, caller: ToolCaller, workdir: string) => Effect.Effect<CommandTime, CommandUnreadable>;
};

const unruled = (asked: number | undefined, bounds: { readonly defaultMs: number; readonly ceilingMs: number }): CommandLimit =>
  asked === undefined
    ? { ms: bounds.defaultMs, origin: 'default', rule: null }
    : { ms: Math.min(asked, bounds.ceilingMs), origin: 'caller', rule: null };

export const unruledTimes: CommandTimes = {
  resolve: (asked) => Effect.succeed({ wait: unruled(asked.waitMs, COMMAND_WAIT), life: unruled(asked.lifeMs, COMMAND_LIFE) }),
};

export const humanMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) {
    const rest = whole % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  const left = minutes % 60;
  return left === 0 ? `${hours}h` : `${hours}h ${left}m`;
};

const limitSource = (limit: CommandLimit, field: string): string =>
  limit.origin === 'rule' && limit.rule !== null
    ? `set by command rule ${limit.rule}`
    : limit.origin === 'caller'
      ? `asked for this command — its \`${field}\`, or a later change`
      : 'the default';

export const waitWords = (wait: CommandLimit): string => `wait ${humanMs(wait.ms)}, ${limitSource(wait, 'waitMs')}`;

export const lifeWords = (life: CommandLimit): string => `life ${humanMs(life.ms)}, ${limitSource(life, 'lifeMs')}`;

export const cleanupWords = (cleanup: Cleanup): string | null =>
  cleanup === 'residual'
    ? 'The ending was measured and resources of this command were found still running.'
    : cleanup === 'pending'
      ? 'Whether every process of this command is gone was still being measured when this was read.'
      : cleanup === 'unverifiable'
        ? 'Whether every process of this command is gone could not be verified.'
        : null;

export const lifeEnded = (life: CommandLimit): string =>
  `Its life ran out (${lifeWords(life)}), so it was stopped. ${
    life.origin === 'rule'
      ? 'A larger `lifeMs` does not raise it past the rule, and the rule binds this work wherever it runs: narrow the command to what the change touches or split it into parts that each fit, or ask the user to change the rule.'
      : life.ms >= COMMAND_LIFE.ceilingMs
        ? 'That is the longest life a command may have: run work that needs longer as a terminal (start_terminal), which no life bounds.'
        : `If the work needs longer, run it again with a larger \`lifeMs\`, at most ${COMMAND_LIFE.ceilingMs} (${humanMs(COMMAND_LIFE.ceilingMs)}), or as a terminal (start_terminal), which no life bounds.`
  }`;

export const IN_BACKGROUND =
  'Its ending arrives here as a notice and wakes you, so do not run it again or wait for it: go on with work that does not need it, or end your turn.';

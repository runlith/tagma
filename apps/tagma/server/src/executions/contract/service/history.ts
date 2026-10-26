import { Context, type Effect } from 'effect';
import type { TerminalUnavailable } from '../wire/refusals.js';

export type ForgottenHistory = {
  readonly commands: number;
  readonly terminals: number;
  readonly holds: number;
};

export class ExecutionHistory extends Context.Service<
  ExecutionHistory,
  {
    forgetThreads(threadIds: readonly string[]): Effect.Effect<ForgottenHistory, TerminalUnavailable>;
    forgetGone(): Effect.Effect<ForgottenHistory, TerminalUnavailable>;
  }
>()('tagma/executions/ExecutionHistory') {}

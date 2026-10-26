import { Context, type Effect } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { TerminalFailure } from './terminals.js';

export type TerminalWatched = { readonly projectId: number; readonly execution: ExecutionRef };

export type TerminalEnding = { readonly _tag: 'Decided'; readonly summary: ExecutionSummary } | { readonly _tag: 'Unwatchable' };

export class TerminalEndings extends Context.Service<
  TerminalEndings,
  {
    readonly decided: (watched: TerminalWatched) => Effect.Effect<TerminalEnding>;
    readonly watch: (watched: TerminalWatched) => Effect.Effect<void>;
    readonly resume: () => Effect.Effect<number, TerminalFailure>;
    readonly attend: () => Effect.Effect<never>;
  }
>()('tagma/executions/TerminalEndings') {}

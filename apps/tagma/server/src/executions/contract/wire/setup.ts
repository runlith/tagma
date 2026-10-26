import type { Effect } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';

export type SetupLaunch = {
  readonly projectId: number;
  readonly cwd: string;
  readonly command: string;
  readonly operation: string;
  readonly started: (execution: ExecutionRef) => Effect.Effect<void, { readonly message: string }>;
};

export type SetupEnding =
  | { readonly _tag: 'Exited'; readonly execution: ExecutionRef; readonly exitCode: number; readonly tail: string }
  | { readonly _tag: 'Unread'; readonly execution: ExecutionRef | null; readonly said: string };

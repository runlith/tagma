import type { Entry } from '@runlith/files/replace';
import { Schema } from 'effect';

export const removalInput = Schema.Struct({
  args: Schema.Array(Schema.String).annotate({
    description: 'Arguments after rm: options and paths or glob patterns. Use -- before names beginning with -. No shell is executed.',
  }),
  workdir: Schema.optional(Schema.String.annotate({ description: 'Directory resolving relative operands; the workspace by default.' })),
  glob: Schema.optional(
    Schema.Boolean.annotate({ description: 'Expand shell-style patterns and ~/; true by default. False treats every operand literally.' }),
  ),
});

export type RemovalInput = typeof removalInput.Type;

export type RemovalOptions = {
  readonly recursive: boolean;
  readonly force: boolean;
  readonly directory: boolean;
  readonly verbose: boolean;
  readonly oneFileSystem: boolean;
  readonly preserveRoot: 'root' | 'all' | 'none';
};

export type RemovalStage = 'expand' | 'resolve' | 'read' | 'unlink' | 'rmdir' | 'record';

export type RemovalIssue = {
  readonly path: string;
  readonly stage: RemovalStage;
  readonly code: string;
  readonly reason: string;
  readonly operands?: readonly string[];
};

export type RemovalTarget = {
  readonly path: string;
  readonly entry: Entry;
  readonly operands: readonly string[];
  readonly tree: boolean;
};

export type RemovalSelection = {
  readonly cwd: string;
  readonly options: RemovalOptions;
  readonly targets: readonly RemovalTarget[];
  readonly nested: ReadonlyMap<string, readonly string[]>;
  readonly issues: readonly RemovalIssue[];
};

export type RemovalResult = {
  readonly path: string;
  readonly kind: string;
  readonly operands: readonly string[];
  readonly status: 'removed' | 'absent' | 'skipped' | 'failed' | 'unprocessed' | 'unknown';
  readonly record?: 'recorded' | 'outside' | 'pending';
  readonly removed?: number;
  readonly issue?: RemovalIssue;
};

export type RemovalReport = {
  readonly status: 'completed' | 'partial' | 'cancelled' | 'unknown';
  readonly counts: Readonly<Record<RemovalResult['status'], number>>;
  readonly pendingConfirmations: number;
  readonly results: readonly RemovalResult[];
  readonly reportPath?: string;
};

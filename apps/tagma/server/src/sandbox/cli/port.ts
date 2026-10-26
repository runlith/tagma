import type { Effect } from 'effect';

export type SandboxCliRow = {
  readonly sandbox: string;
  readonly state: string;
  readonly boundThreadId: string | null;
  readonly source: { readonly kind: string; readonly commit?: string } | null;
  readonly failureReason: string | null;
  readonly exportPath: string | null;
};

export type SandboxCli = {
  readonly list: (project?: string) => Effect.Effect<readonly SandboxCliRow[], unknown>;
  readonly birth: (input: {
    readonly project?: string;
    readonly id: string;
    readonly type: string;
    readonly title?: string;
  }) => Effect.Effect<{ readonly id: string; readonly thread: unknown }, unknown>;
};

export type SessionSigner = { readonly harness: string; readonly variable?: string | undefined };

export const PACKAGE_VARIABLE = 'TAGMA_ADAPTER_PACKAGE';

export const SESSION_VARIABLES = {
  codex: 'CODEX_THREAD_ID',
  opencode: 'OPENCODE_SESSION_ID',
} as const;

export const SESSION_SIGNERS: readonly { readonly harness: keyof typeof SESSION_VARIABLES; readonly variable: string }[] = (
  Object.keys(SESSION_VARIABLES) as (keyof typeof SESSION_VARIABLES)[]
).map((harness) => ({ harness, variable: SESSION_VARIABLES[harness] }));

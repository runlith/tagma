export const SESSION_VARIABLES = {
  'claude-code': 'CLAUDE_CODE_SESSION_ID',
  codex: 'CODEX_THREAD_ID',
  grok: 'GROK_SESSION_ID',
  opencode: 'OPENCODE_SESSION_ID',
} as const;

export const SESSION_SIGNERS: readonly { readonly harness: keyof typeof SESSION_VARIABLES; readonly variable: string }[] = (
  Object.keys(SESSION_VARIABLES) as (keyof typeof SESSION_VARIABLES)[]
).map((harness) => ({ harness, variable: SESSION_VARIABLES[harness] }));

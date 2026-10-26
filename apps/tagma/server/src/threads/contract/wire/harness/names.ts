import { Schema } from 'effect';

export const HARNESS_AGENT_ID = 'harness';
export const HARNESS_NAMES = ['claude-code', 'codex', 'grok', 'devin', 'cursor', 'gemini', 'opencode'] as const;
export type HarnessName = (typeof HARNESS_NAMES)[number];

export const harnessNameSchema = Schema.Literals(HARNESS_NAMES);

export const harnessTransportSchema = Schema.Literals(['terminal', 'acp']);
export type HarnessTransport = typeof harnessTransportSchema.Type;

export const HARNESS_LABELS: Readonly<Record<HarnessName, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  devin: 'Devin',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
};

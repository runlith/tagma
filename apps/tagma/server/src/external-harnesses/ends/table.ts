import type { HarnessAdapter } from '../contract/service/adapter.js';
import { claudeEnds } from '../vendors/claude-code/ends.js';
import { codexEnds } from '../vendors/codex/ends.js';
import { cursorEnds } from '../vendors/cursor/ends.js';
import { devinEnds } from '../vendors/devin/ends.js';
import { grokEnds } from '../vendors/grok/ends.js';
import type { TailSource } from './tail.js';

const sources = {
  'claude-jsonl': claudeEnds,
  'codex-rollout': codexEnds,
  'grok-summary': grokEnds,
  'devin-atif': devinEnds,
  'cursor-terminal': cursorEnds,
} satisfies Record<NonNullable<HarnessAdapter['metadata']>, TailSource>;

export const endsSource = (adapter: HarnessAdapter): TailSource | null =>
  adapter.metadata === undefined ? null : sources[adapter.metadata];

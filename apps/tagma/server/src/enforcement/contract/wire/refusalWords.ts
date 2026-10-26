import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'enforcement-stale': 'Rule changed meanwhile',
  'format-cut': 'Formatting ran too long',
  'format-failed': 'Formatting failed',
  'format-missing': 'Formatter not found',
  'git-unavailable': 'Git could not run',
  'inspection-failed': 'Rule check failed',
  'inspection-required': 'Rule needs a check',
  'inspection-unknown': 'Check not defined',
  'module-shape': 'Module card invalid',
  'module-map-invalid': 'Module map invalid',
  'not-enforced': 'Rule is not enforced',
  'out-of-scope': 'Outside this project',
  'pack-unused': 'Check pack not in use',
  'reach-empty': 'Rule covers no code',
  'rule-disabled': 'Rule is switched off',
  'rule-violated': 'Blocked by a rule',
  'trigger-unknown': 'Unknown trigger',
} as const satisfies RefusalWords;

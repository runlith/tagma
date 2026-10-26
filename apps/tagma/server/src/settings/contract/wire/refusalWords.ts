import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'setting-conflict': 'Conflicts with a value that stands',
  'setting-managed': 'Setting is managed elsewhere',
  'setting-scope': 'Wrong scope for this setting',
  'setting-value': 'Setting value is invalid',
  'unknown-setting': 'Unknown setting',
} as const satisfies RefusalWords;

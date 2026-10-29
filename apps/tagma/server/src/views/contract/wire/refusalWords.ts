import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'app-call-failed': 'App tool failed',
  'app-resource-failed': 'App view failed to load',
  'app-tool-unoffered': 'Tool not offered to views',
  'app-unavailable': 'App unavailable',
  'app-view-unknown': 'App has no such view',
  'view-storage-failed': 'View data not saved',
  'view-storage-too-large': 'View value too large',
} as const satisfies RefusalWords;

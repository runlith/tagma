import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'plugin-action-unknown': 'Plugin has no such action',
  'plugin-call-failed': 'Plugin tool failed',
  'plugin-resource-failed': 'Plugin view failed to load',
  'plugin-tool-unoffered': 'Tool not offered to views',
  'plugin-unavailable': 'Plugin unavailable',
  'plugin-view-unknown': 'Plugin has no such view',
  'view-storage-failed': 'View data not saved',
  'view-storage-too-large': 'View value too large',
} as const satisfies RefusalWords;

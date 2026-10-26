import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'ask-standing': 'A question is still open',
  'conflicts-unreadable': 'Conflicts could not be read',
  'execution-gone': 'CLI process is gone',
  'harness-lane-unopened': 'Typing channel not opened',
  'harness-unhooked': 'CLI has no hook support here',
  'job-unproven': 'CLI not yet tied to the terminal',
  'not-hosted': 'Thread runs no hosted agent',
  'not-interactive': 'CLI has no terminal to type into',
  'not-under-shell': 'CLI not started from the terminal',
  'observation-time': 'Hook time invalid',
  'profile-transport': 'Profile thread runs on terminal only',
  'protocol-unavailable': 'Thread speaks no protocol',
  'run-not-held': 'Run held by another server',
  'screen-unavailable': 'No terminal screen to show',
  'shell-unknown': 'Terminal not found',
  'stale-execution': 'Session changed meanwhile',
  'storage-changed': 'Launch environment changed',
  'transport-unavailable': 'Transport not available for this CLI',
  'typing-unavailable': 'Cannot type into this session',
} as const satisfies RefusalWords;

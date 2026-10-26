import { family } from '@runlith/paging';

export const CHANGES = family('changes', 3, 'text', { text: 240, json: 240 }, 50, () => ({
  runId: '01a0cad5-20dd-7ab7-bb04-f7885cb4586c',
  checkout: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  path: 'x'.repeat(60),
  state: 'committed',
  commit: 'f'.repeat(40),
}));

export const CHANGE_PAGE_ROWS = 50;

export const THREAD_HISTORY = family('thread-history', 1, 'json', { text: 240, json: 240 }, 200, () => ({
  runId: '01a0cad5-20dd-7ab7-bb04-f7885cb4586c',
  checkout: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  path: 'x'.repeat(60),
  at: 1_790_000_000_000,
  state: 'committed',
  commit: 'f'.repeat(40),
  reason: null,
}));

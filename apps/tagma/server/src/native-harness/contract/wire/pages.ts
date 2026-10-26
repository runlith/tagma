import { family } from '@runlith/paging';

export const CALLS = family('calls', 1, 'text', { text: 495, json: 1634 }, 100, () => ({
  runId: '01a0cac5-0fff-70e4-ba24-a2fb2228a14d',
  toolCallId: 'toolu_01DvmkMENm9wVeNmGrDBiULE',
  threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  name: 'read_thread',
  input: { threadId: 'x'.repeat(36), select: 'entries' },
}));

export const COMPACTION_CHOICES = family('compaction-choices', 1, 'json', { text: 521, json: 521 }, 'ceiling', () => ({
  provider: 'x'.repeat(11),
  model: 'x'.repeat(28),
  label: 'x'.repeat(28),
  providerLabel: 'x'.repeat(16),
  reasoning: 'xhigh',
  own: false,
  spendable: false,
  skip: { reason: 'rate-limited', until: '2026-09-25T18:40:00.000Z' },
  pays: { provider: 'x'.repeat(11), account: 'x'.repeat(40) },
  estimate: { inputTokens: 1_000_000, passes: 12 },
}));

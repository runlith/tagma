import { family } from '@runlith/paging';

export const MESSAGE_CHARS = 160;

export const INSPECTIONS = family('inspections', 1, 'text', { text: 210, json: 260 }, 20, () => ({
  name: 'Effect.noSwallowedFailures',
  summary: 'x'.repeat(150),
  concern: 'loading',
  door: '/rules/effect',
}));

export const FIX_CHARS = 240;

export const VIOLATIONS = family('violations', 1, 'text', { text: 560, json: 720 }, 100, () => ({
  rule: 'x'.repeat(8),
  title: 'x'.repeat(80),
  strictness: 'watch',
  holders: ['x'.repeat(36)],
  fingerprint: `${'x'.repeat(60)} × ${'x'.repeat(20)}`,
  file: 'x'.repeat(60),
  line: 120,
  message: 'x'.repeat(MESSAGE_CHARS),
  fix: 'x'.repeat(FIX_CHARS),
}));

import type { TeamEdit } from '@runlith/agent/collaboration/team';
import { expect, test } from 'vitest';
import { rowEdit, withoutFields } from './edits.js';

const SOL = { provider: 'openai-oauth', model: 'gpt-6.1-sol', reasoning: 'high' };

test('a row edited by several patches reads as one edit, and dropping a field drops it from every standing patch', () => {
  const edits: readonly TeamEdit[] = [
    { ...SOL, depth: 2 },
    { ...SOL, removed: true },
    { ...SOL, depth: 4, note: 'deep' },
    { ...SOL, reviews: true },
  ];

  expect(rowEdit(edits, SOL)).toEqual({ ...SOL, depth: 4, note: 'deep', reviews: true });

  const dropped = withoutFields(edits, SOL, ['depth']);
  expect(rowEdit(dropped, SOL)).toEqual({ ...SOL, note: 'deep', reviews: true });
  expect(dropped[0]).toEqual({ ...SOL, depth: 2 });
});

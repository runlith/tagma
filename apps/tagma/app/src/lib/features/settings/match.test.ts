import { match } from '@runlith/search-text/match';
import { expect, test } from 'vitest';
import { settingTarget } from './match.js';

const entry = { id: 'agent.model', title: 'Default model', description: 'The model a new thread starts on.' };

const found = (query: string): boolean => match(query, settingTarget(entry)) !== null;

test('every word must stand in the title, the description or the id, in any case and with a typo forgiven', () => {
  expect(found('MODEL thread')).toBe(true);
  expect(found('agent.model')).toBe(true);
  expect(found('defualt modle')).toBe(true);
  expect(found('model terminal')).toBe(false);
});

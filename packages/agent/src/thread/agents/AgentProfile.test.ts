import { describe, expect, test } from 'bun:test';
import { parseThreadProfile } from '../persisted';
import type { ThreadProfileBirth } from './AgentProfile';

describe('the overlay declares itself once', () => {
  test('a stored overlay keeps its prompt, its capabilities and its planes through the row decoder', () => {
    const born: ThreadProfileBirth = {
      id: 'stories',
      overlay: {
        id: 'stories',
        baseAgentId: 'declared',
        description: 'Writes a story.',
        prompt: 'You write one story.',
        capabilities: ['files'],
        runtimeSources: ['collaboration'],
      },
    };
    expect(parseThreadProfile(JSON.parse(JSON.stringify(born)))).toEqual(born);
  });
});

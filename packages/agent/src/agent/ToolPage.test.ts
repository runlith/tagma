import { describe, expect, test } from 'bun:test';
import { toolPage } from './ToolPage';

const rows = [
  { label: 'alpha', facts: ['working', '2m ago'] },
  { label: 'beta', facts: ['idle'] },
];

describe('a page of a collection', () => {
  test('names what was shown, the order it came in, and the call that continues', () => {
    const answer = toolPage({ rows, total: 148, order: 'working first, then newest', next: 'list_agents(after=2)', empty: 'no agents' });

    expect(answer.value).toBe(
      ['alpha · working · 2m ago', 'beta · idle', 'showing 2 of 148 · working first, then newest · next: list_agents(after=2)'].join('\n'),
    );
  });

  test('offers no continuation when the page is the whole collection', () => {
    const answer = toolPage({ rows, total: 2, order: 'newest first', empty: 'no agents' });

    expect(answer.value).toBe(['alpha · working · 2m ago', 'beta · idle', 'showing 2 of 2 · newest first'].join('\n'));
  });

  test('an empty collection answers the tool`s own sentence, never an empty string', () => {
    const answer = toolPage({ rows: [], total: 0, order: 'newest first', empty: 'no agents run on this server' });

    expect(answer.value).toBe('no agents run on this server');
  });

  test('the reader`s half carries the same rows and the total the window was cut from', () => {
    const answer = toolPage({ rows, total: 148, order: 'newest first', next: 'x', empty: 'none', title: 'agents' });

    expect(answer.display).toEqual({
      form: 'list',
      title: 'agents',
      items: [
        { label: 'alpha', detail: 'working · 2m ago' },
        { label: 'beta', detail: 'idle' },
      ],
      total: 148,
      facts: [{ label: 'shown', value: '2 of 148' }],
    });
  });
});

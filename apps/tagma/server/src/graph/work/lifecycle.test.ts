import { expect, test } from 'bun:test';
import type { Tag } from '../contract/wire/tags/declaration.js';
import { checkTransition } from './lifecycle.js';
import { TagIndex } from '../vocabulary/tagIndex.js';
import { GRAPH_BEHAVIOURS } from '../testing/behaviours.js';

const declared: Tag = {
  id: 'ticket',
  fields: { state: { type: 'enum', values: ['open', 'in_work', 'done', 'dropped'] }, owner: 'session' },
  edges: [],
  gates: [
    { gate: 'transition', field: 'state', from: 'open', to: 'in_work' },
    { gate: 'transition', field: 'state', from: 'in_work', to: 'done' },
    { gate: 'transition', field: 'state', from: 'open', to: 'dropped' },
  ],
  roles: {
    status: { field: 'state', initial: 'open', claimed: 'in_work', done: 'done', closed: 'dropped' },
    holder: 'owner',
    work: true,
  },
  body: { shape: 'content' },
  prompt: '',
};

const table = new TagIndex([declared], GRAPH_BEHAVIOURS);
const ticket = table.tagById('ticket')!;
const moves = table.actionsOf('ticket');

const note: Tag = { id: 'note', fields: {}, edges: [], gates: [], roles: {}, body: { shape: 'content' }, prompt: '' };

function refusal(verdict: ReturnType<typeof checkTransition>): { code: string; reason: string } {
  if (verdict.ok) throw new Error('the move was admitted, and this case is about the refusal');
  return { code: verdict.code, reason: verdict.reason };
}

test('a tag nobody shipped walks claim and finish, because the moves are its own declaration', () => {
  expect(checkTransition(moves, ticket, 'open', 'in_work')).toEqual({ ok: true });
  expect(checkTransition(moves, ticket, 'in_work', 'done')).toEqual({ ok: true });

  const back = refusal(checkTransition(moves, ticket, 'done', 'in_work'));
  expect(back.code).toBe('illegal-transition');
  expect(back.reason).toContain('"done" → "in_work"');
});

test('a word the tag never declared, and a tag that reports no work at all', () => {
  const outside = refusal(checkTransition(moves, ticket, 'open', 'closed'));
  expect(outside.code).toBe('illegal-status');
  expect(outside.reason).toContain('#ticket.state');

  const noWork = refusal(checkTransition(moves, note, null, 'open'));
  expect(noWork.code).toBe('no-status');
  expect(noWork.reason).toContain('#note');
  expect(refusal(checkTransition(moves, null, null, 'open')).code).toBe('no-status');
});

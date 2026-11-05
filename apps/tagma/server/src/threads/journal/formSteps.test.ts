import { expect, test } from 'bun:test';
import { Result } from 'effect';
import { makeThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { decodeThreadEventPayloadResult, runFacts } from '@runlith/agent/thread/persisted';
import { journalSteps } from './formSteps.js';

const dated: ThreadFormStep = {
  name: '20261010170000_message_when',
  samples: { entry: { type: 'message', when: 'at' } },
  entry: (entry) => {
    if (entry.type !== 'message' || entry.when === undefined) return null;
    const { when, ...rest } = entry;
    return { ...rest, occurredAt: when };
  },
};

const recast: ThreadFormStep = {
  name: '20261010180000_message_role',
  samples: { entry: { type: 'message', role: 'user' } },
  entry: (entry) => (entry.type === 'message' && entry.role === 'user' ? { ...entry, role: 'assistant' } : null),
};

const old = { type: 'message', id: 'm-1', role: 'user', text: 'go', when: 'at' };
const current = { type: 'message', id: 'm-1', role: 'user', text: 'go', occurredAt: 'at' };

test('a record in an old form leaves the reader in the current form, and a current record leaves it unchanged', () => {
  const kinds = makeThreadEntryReader({ products: [], steps: journalSteps([[dated]]) });

  expect(Result.isFailure(makeThreadEntryReader({ products: [] }).decode(old))).toBe(true);
  expect(kinds.decode(old)).toEqual(Result.succeed(current));
  expect(kinds.decode(current)).toEqual(Result.succeed(current));
  expect(decodeThreadEventPayloadResult(kinds, 'thread-1', { entry: old })).toEqual(Result.succeed({ entry: current }));
  expect(runFacts(kinds, { id: 'run-1', threadId: 'thread-1' }).streamTail([old, current])).toEqual([current, current]);
});

test('a step that moves a field queries over many threads read is refused on every record it would move', () => {
  const kinds = makeThreadEntryReader({ products: [], steps: journalSteps([[recast]]) });
  const read = kinds.decode(current);

  expect(Result.isFailure(read) && read.failure.issue).toEqual(expect.stringContaining('20261010180000_message_role'));
  expect(kinds.decode({ ...current, role: 'assistant' })).toEqual(Result.succeed({ ...current, role: 'assistant' }));
});

test('the steps of every module stand in one order by name, and a misnamed, repeated or backward declaration is refused', () => {
  const later: ThreadFormStep = { name: '20261011000000_later', samples: {} };
  const earlier: ThreadFormStep = { name: '20261009000000_earlier', samples: {} };

  expect(journalSteps([[later], [earlier]]).map((step) => step.name)).toEqual([earlier.name, later.name]);
  expect(makeThreadEntryReader({ products: [], steps: journalSteps([[later], [earlier]]) }).last).toBe(later.name);
  expect(() => journalSteps([[{ name: 'message_when', samples: {} }]])).toThrow();
  expect(() => journalSteps([[dated], [dated]])).toThrow();
  expect(() => journalSteps([[later, earlier]])).toThrow();
});

test('each step forms the whole event before the next one reads it, the messages it carries included', () => {
  const tagged: ThreadFormStep = {
    name: '20261010190000_payload_seen',
    samples: { payload: { entry: { occurredAt: 'at' } } },
    payload: (payload) =>
      (payload.entry as { occurredAt?: unknown } | undefined)?.occurredAt === undefined || payload.seen !== undefined
        ? null
        : { ...payload, seen: true },
  };
  const spoken: ThreadFormStep = {
    name: '20261010200000_message_content',
    samples: { message: { role: 'assistant', content: 'told' } },
    message: (message) => (typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : null),
  };
  const kinds = makeThreadEntryReader({ products: [], steps: journalSteps([[dated, tagged, spoken]]) });
  const told = { role: 'assistant', content: 'told' };
  const said = { role: 'assistant', content: [{ type: 'text', text: 'told' }] };

  expect(kinds.formedEvent({ entry: old, messages: [told], compacted: { keepFrom: 0, messages: [told] } })).toEqual({
    entry: current,
    seen: true,
    messages: [said],
    compacted: { keepFrom: 0, messages: [said] },
  });
});

import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { OpenParts } from './OpenParts';

test('a part shows from its first visible text, stays shown sealed until it lands, and an input shows its raw text', () => {
  const parts = new OpenParts('run-1', () => '2026-10-18T00:00:00.000Z');
  parts.open('message', 'a', () => 'message-0');
  expect(parts.append('a', '  ')).toBeNull();
  expect(parts.append('a', 'Hel')).toEqual({ id: 'message-0', text: 'Hel', opened: true });
  parts.appendInput('call-1', 'read', 'tool-1', '{"pa');
  const saved = parts.tail();
  expect(Schema.is(Schema.Json)(saved)).toBe(true);
  expect(parts.append('a', 'lo \r')).toEqual({ id: 'message-0', text: 'lo', opened: false });
  expect(saved).toMatchObject([{ text: 'Hel' }, { toolInputRaw: { text: '{"pa' } }]);
  expect(parts.seal('a')).toMatchObject({ type: 'message', id: 'message-0', text: 'Hello' });
  expect(parts.tail()).toMatchObject([
    { type: 'message', id: 'message-0', text: 'Hello' },
    { type: 'tool', id: 'tool-1', toolState: 'input-streaming', toolInputRaw: { kind: 'text', text: '{"pa', complete: false } },
  ]);
  expect(parts.landed(new Set(['message-0']))).toEqual(['message-0']);
  expect(parts.tail().map((entry) => entry.id)).toEqual(['tool-1']);
});

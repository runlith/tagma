import { expect, test } from 'bun:test';
import { historyBlocks } from './history.js';

test('session history keeps image bytes between the text blocks and the tool result they belonged to', () => {
  const image = { type: 'image' as const, data: 'image-bytes', mimeType: 'image/png' };
  const blocks = historyBlocks([
    { role: 'user', content: [{ type: 'text', text: 'before' }, image, { type: 'text', text: 'after' }] },
    { role: 'assistant', content: [{ type: 'call', id: 'call', name: 'read', input: { path: '/image' } }] },
    { role: 'result', id: 'call', failed: false, content: [image, { type: 'text', text: 'result' }] },
  ]);
  expect(
    blocks.filter((block) => block.type === 'image' || (block.type === 'text' && ['before', 'after', 'result'].includes(block.text))),
  ).toEqual([{ type: 'text', text: 'before' }, image, { type: 'text', text: 'after' }, image, { type: 'text', text: 'result' }]);
});

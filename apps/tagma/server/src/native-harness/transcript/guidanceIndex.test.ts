import { expect, test } from 'bun:test';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import { Message } from '@runlith/llm/schema/messages';
import { GuidanceIndex } from './guidanceIndex.js';

const key = 'project-instructions@2';
const law = { projectId: 2, root: '/beta' };
const call = (id: string) => Message.assistant([{ type: 'tool-call', id, name: 'write', input: {} }]);

test('a sealed assistant batch retains the law from its input, across later guidance and compaction', () => {
  const batch = new GuidanceIndex().append([
    Message.assistant([
      { type: 'tool-call', id: 'first', name: 'write', input: {} },
      { type: 'tool-call', id: 'second', name: 'write', input: {} },
    ]),
  ]);
  const delivered = batch.append([agentRuntimeGuidanceMessage('law', { [key]: law })]);
  expect(delivered.read(key, 'first')).toBeUndefined();
  expect(delivered.read(key, 'second')).toBeUndefined();
  expect(delivered.read(key)?.value).toEqual(law);
  expect(batch.read(key)).toBeUndefined();
  const next = delivered.append([call('next')]);
  expect(next.read(key, 'next')).toEqual({ position: 1, value: law });
  const reset = next.append([
    new Message({
      role: 'user',
      content: [{ type: 'text', text: 'Summary.' }],
      compaction: { id: 'reset', mode: 'manual', transcriptLocation: '/alpha', preservedCount: 0 },
    }),
  ]);
  expect(reset.read(key, 'after-reset')).toBeUndefined();
  expect(next.read(key, 'next')?.value).toEqual(law);
});

test('delivery reads visit no messages after either a short or a long appended history', () => {
  let reads = 0;
  const counted = () =>
    new Proxy(Message.user('result'), {
      get(target, property, receiver) {
        if (property === 'role' || property === 'content' || property === 'metadata' || property === 'compaction') reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
  let index = new GuidanceIndex().append([agentRuntimeGuidanceMessage('law', { [key]: law })]);
  for (const count of [1, 128]) {
    index = index.append(Array.from({ length: count }, counted)).append([call(`write-${count}`)]);
    reads = 0;
    expect(index.read(key, `write-${count}`)?.value).toEqual(law);
    expect(index.read(key)?.value).toEqual(law);
    expect(reads).toBe(0);
  }
});

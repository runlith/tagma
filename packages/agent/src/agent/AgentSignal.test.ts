import { describe, expect, test } from 'bun:test';
import { Message } from '@runlith/llm/schema/messages';
import {
  agentReaderPosition,
  agentInputSkills,
  agentOriginOf,
  agentRuntimeGuidanceMessage,
  agentSignalMarkup,
  agentSignalMessage,
} from './AgentSignal';
import { USER_MESSAGE_SIGNAL_TYPE } from './contracts';

describe('agent signals', () => {
  test('wraps signal text in type-named markup with XML escaping', () => {
    const type = 'agent-message';
    const markup = agentSignalMarkup({ type, text: 'use <b> & friends' });

    expect(markup).toBe(`<${type}>use &lt;b&gt; &amp; friends</${type}>`);
  });

  test('rejects signal types that cannot form a markup tag', () => {
    expect(() => agentSignalMarkup({ type: 'bad type!', text: 'x' })).toThrow();
  });

  test('delivers an envelope sender and receipt as model-visible attributes', () => {
    const message = agentSignalMessage({
      id: 'signal-1',
      type: 'message',
      text: 'Please review it.',
      from: 'wait-doors',
      senderThreadId: '01a06233-d5be-7a4e-9d43-504743b3df0c',
      envelopeId: '02d50b00-8b24-7d9e-bd21-af4aba9f92b1',
      occurredAt: '2026-06-10T10:00:00Z',
    });

    expect(message.role).toBe('user');
    expect(message.content).toEqual(
      Message.user(
        '<message from="wait-doors" thread="01a06233-d5be-7a4e-9d43-504743b3df0c" envelope="02d50b00-8b24-7d9e-bd21-af4aba9f92b1">Please review it.</message>',
      ).content,
    );
  });

  test('keeps runtime-produced guidance byte-stable without sender attributes', () => {
    const message = agentSignalMessage({
      id: 'guidance-1',
      type: 'runtime-guidance',
      text: 'Read the graph first.',
      occurredAt: '2026-06-10T10:00:00Z',
    });

    expect(message.content).toEqual(Message.user('<runtime-guidance>Read the graph first.</runtime-guidance>').content);
  });

  test('what the runtime injects says so, and an ordinary turn says nothing', () => {
    expect(agentOriginOf(agentSignalMessage({ id: 'signal-2', type: 'message', text: 'hi', occurredAt: '2026-06-10T10:00:00Z' }))).toBe(
      'envelope',
    );
    expect(agentOriginOf(agentRuntimeGuidanceMessage('Read the graph first.'))).toBe('guidance');
    expect(agentOriginOf(Message.user('hello'))).toBeUndefined();
  });

  test('reader input survives signal wrapping and a JSON round trip without admitting machine prose', () => {
    const text = '$writer with <literal> & $reviewer';
    const signal = { id: 'steer', type: USER_MESSAGE_SIGNAL_TYPE, text, readerPosition: 12, occurredAt: '2026-09-06T04:00:00Z' };
    const reader = agentSignalMessage({ ...signal, addressee: 'reader' });
    expect(agentInputSkills(Message.make(JSON.parse(JSON.stringify(reader))))).toEqual(new Set(['writer', 'reviewer']));
    expect(agentReaderPosition(Message.make(JSON.parse(JSON.stringify(reader))))).toBe(12);
    expect(agentInputSkills(agentSignalMessage({ ...signal, addressee: 'transport' }))).toBeNull();
    expect(agentInputSkills(agentRuntimeGuidanceMessage(text))).toBeNull();
    expect(agentInputSkills(Message.user(text))).toEqual(new Set(['writer', 'reviewer']));
  });

  test('a metadata value that is not an origin the kernel writes reads as no origin', () => {
    expect(agentOriginOf(Message.make({ role: 'user', content: 'hello', metadata: { origin: 'whatever' } }))).toBeUndefined();
  });
});

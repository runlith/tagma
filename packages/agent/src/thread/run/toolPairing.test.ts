import { describe, expect, test } from 'bun:test';
import { Message, ToolCallPart, ToolResultPart } from '@runlith/llm/schema/messages';
import { pairedForProvider } from './toolPairing';

const call = (id: string, name = 'bash') => Message.assistant([ToolCallPart.from({ id, name, input: { command: 'true' } })]);
const result = (id: string, name = 'bash') => Message.tool(ToolResultPart.from({ id, name, result: 'ok' }));

describe('pairedForProvider', () => {
  test('closes a call whose run ended before it answered', () => {
    const paired = pairedForProvider([Message.user('go'), call('a'), Message.user('and now this')]);

    expect(paired.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    const closing = paired[2]?.content[0];
    expect(closing?.type).toBe('tool-result');
    expect(closing?.type === 'tool-result' && closing.id).toBe('a');
    expect(closing?.type === 'tool-result' && closing.result.type).toBe('error');
  });

  test('drops a result whose call is no longer in the request', () => {
    const paired = pairedForProvider([Message.user('go'), result('gone')]);

    expect(paired.map((message) => message.role)).toEqual(['user']);
  });

  test('a request that already pairs is handed on as it stands', () => {
    const messages = [Message.user('go'), call('a'), result('a')];

    expect(pairedForProvider(messages)).toBe(messages);
  });

  test('moves what arrived mid-call after the answer it interrupted', () => {
    const paired = pairedForProvider([call('a'), Message.user('while you were working'), result('a')]);

    expect(paired.map((message) => message.role)).toEqual(['assistant', 'tool', 'user']);
    expect(paired[1]?.content[0]?.type === 'tool-result' && paired[1]?.content[0]?.id).toBe('a');
  });

  test('answers every call of one message in one answer', () => {
    const both = Message.assistant([
      ToolCallPart.from({ id: 'a', name: 'bash', input: {} }),
      ToolCallPart.from({ id: 'b', name: 'bash', input: {} }),
    ]);
    const paired = pairedForProvider([both, result('b')]);

    expect(paired.map((message) => message.role)).toEqual(['assistant', 'tool']);
    expect(paired[1]?.content.map((part) => (part.type === 'tool-result' ? part.id : part.type))).toEqual(['a', 'b']);
  });
});

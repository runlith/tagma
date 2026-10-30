import { expect, test } from 'bun:test';
import { cursorTerminal } from './cursor.js';

const codec = cursorTerminal.hooks!.codec;

test('Cursor hook permissions preserve the decision and its explanation', () => {
  expect(JSON.parse(codec.permission({ allowed: true, words: 'allowed by rule' }))).toEqual({
    permission: 'allow',
    user_message: 'allowed by rule',
  });
  expect(JSON.parse(codec.permission({ allowed: false, words: 'denied by rule' }))).toEqual({
    permission: 'deny',
    user_message: 'denied by rule',
  });
});

test('Cursor context, prompt and tool answers carry top-level additional_context', () => {
  expect(JSON.parse(codec.context('the law'))).toEqual({ additional_context: 'the law' });
  expect(JSON.parse(codec.prompt!('the law'))).toEqual({ additional_context: 'the law' });
  expect(JSON.parse(codec.tool('over the lines you read', 'after'))).toEqual({ additional_context: 'over the lines you read' });
});

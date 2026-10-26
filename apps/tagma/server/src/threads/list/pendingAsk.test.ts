import { expect, test } from 'bun:test';
import { THREAD_TOOL_CANCEL_VALUE, THREAD_TOOL_CONFIRM_KIND, THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import { makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { ASK_TEXT_CHARS, nativeAsk } from './pendingAsk.js';

const CORE = makeThreadEntryReader({ products: [] });

const question = (questions: readonly Record<string, unknown>[]) => ({
  type: 'question',
  id: 'entry-1',
  runId: 'run-1',
  questionId: 'q-1',
  questions: questions.map((prompt, index) => ({ id: `p-${index}`, toolCallId: `call-${index}`, ...prompt })),
  toolCalls: questions.map((_, index) => ({ toolCallId: `call-${index}`, toolName: 'bash' })),
  status: 'open',
});

const answersOf = (pending: unknown) => nativeAsk(CORE, pending, 'run-1')?.options.map((option) => option.answers);

const CONFIRM_OPTIONS = [
  { value: THREAD_TOOL_CONFIRM_VALUE, label: 'Run it' },
  { value: THREAD_TOOL_CANCEL_VALUE, label: 'Skip' },
];

test('one confirmation answers confirm or cancel; several under one card, or one without both values, answer nothing', () => {
  const push = { kind: THREAD_TOOL_CONFIRM_KIND, prompt: 'Run `git push`', options: CONFIRM_OPTIONS };
  expect(answersOf(question([push]))).toEqual([
    [{ questionId: 'p-0', values: [THREAD_TOOL_CONFIRM_VALUE] }],
    [{ questionId: 'p-0', values: [THREAD_TOOL_CANCEL_VALUE] }],
  ]);
  const wipe = { kind: THREAD_TOOL_CONFIRM_KIND, prompt: 'Run `rm -rf dist`', options: CONFIRM_OPTIONS };
  expect(answersOf(question([push, wipe]))).toEqual([]);
  expect(answersOf(question([{ ...push, options: [{ value: 'yes', label: 'Yes' }] }]))).toEqual([]);
});

test('one single-choice question answers by each option; anything a tap cannot answer whole answers nothing', () => {
  const choice = {
    prompt: 'Tabs or drawer?',
    options: [
      { value: 'tabs', label: 'Tabs' },
      { value: 'drawer', label: 'Drawer' },
    ],
  };
  expect(answersOf(question([choice]))).toEqual([[{ questionId: 'p-0', values: ['tabs'] }], [{ questionId: 'p-0', values: ['drawer'] }]]);
  expect(answersOf(question([{ ...choice, allowMultiple: true }]))).toEqual([]);
  expect(answersOf(question([choice, choice]))).toEqual([]);
  expect(answersOf(question([{ ...choice, secret: true }]))).toEqual([]);
  expect(answersOf(question([{ ...choice, prompt: 'x'.repeat(ASK_TEXT_CHARS + 1) }]))).toEqual([]);
});

test('the ask carries the question header, the unconfirmed delivery and its reason from the stored question', () => {
  const choice = { prompt: 'Allow `git push`?', header: 'No call id was named', options: [{ value: 'allow', label: 'Allow' }] };
  const stored = { ...question([choice]), deliveryUnknown: true, deliveryNote: 'The answer was typed but never confirmed.' };
  expect(nativeAsk(CORE, stored, 'run-1')).toMatchObject({
    header: 'No call id was named',
    deliveryUnknown: true,
    deliveryNote: 'The answer was typed but never confirmed.',
  });
  expect(nativeAsk(CORE, question([choice]), 'run-1')?.deliveryUnknown).toBeUndefined();
});

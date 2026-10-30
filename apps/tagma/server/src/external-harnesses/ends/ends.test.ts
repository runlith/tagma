import { expect, test } from 'bun:test';
import { grok as grokProvider } from '@runlith/adapter-xai/harness';
import { declaredHarness } from '../adapter/declared.js';
import { builtinHarness } from '../testing/builtin.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { TailEnd } from '@runlith/tagma/adapter/metadata';
import { TailScan } from './tail.js';

const START = Date.parse('2026-10-08T22:00:10.000Z');

const endOf = (name: HarnessName, records: readonly unknown[], since: number = START): TailEnd => {
  const source = (name === 'grok' ? declaredHarness(grokProvider) : builtinHarness(name))?.metadata?.ends;
  if (source === undefined) throw new Error(`${name} has no transcript reader`);
  const scan = new TailScan(source.reader, { since, offset: 0, turn: null });
  const steps = source.reader.records?.({ steps: records }) ?? records;
  scan.feed([...steps].reverse());
  return scan.finish();
};

const at = (seconds: number): string => new Date(START + seconds * 1000).toISOString();

const claudeUser = (seconds: number, content: unknown) => ({ type: 'user', timestamp: at(seconds), message: { content } });
const claudeAssistant = (seconds: number, stop: string | null, content: unknown) => ({
  type: 'assistant',
  timestamp: at(seconds),
  message: { stop_reason: stop, content },
});
const text = (value: string) => [{ type: 'text', text: value }];

test('Claude: the final assistant message ends the run, an interrupt mark aborts it, and a turn without either is open', () => {
  const asked = claudeUser(1, 'work');
  const working = claudeAssistant(2, 'tool_use', [{ type: 'tool_use', name: 'Bash' }]);
  const result = claudeUser(3, [{ type: 'tool_result', is_error: false }]);
  const tail = [
    { type: 'system', subtype: 'stop_hook_summary', timestamp: at(5) },
    { type: 'system', subtype: 'turn_duration', timestamp: at(5) },
    { type: 'mode' },
  ];
  expect(endOf('claude-code', [asked, working, result, claudeAssistant(4, 'end_turn', text('done')), ...tail])).toEqual({
    _tag: 'Completed',
    message: 'done',
  });
  expect(
    endOf('claude-code', [
      asked,
      working,
      claudeUser(3, [{ type: 'tool_result', is_error: true }]),
      claudeUser(3, text('[Request interrupted by user for tool use]')),
    ]),
  ).toEqual({ _tag: 'Aborted' });
  expect(
    endOf('claude-code', [asked, claudeAssistant(2, null, text('partial')), claudeUser(3, text('[Request interrupted by user]'))]),
  ).toEqual({
    _tag: 'Aborted',
  });
  expect(endOf('claude-code', [asked])).toEqual({ _tag: 'Open' });
  expect(
    endOf('claude-code', [{ ...claudeAssistant(-30, 'end_turn', text('older turn')) }, { type: 'attachment', timestamp: at(0) }]),
  ).toEqual({
    _tag: 'Open',
  });
  expect(endOf('claude-code', [asked, { ...claudeAssistant(4, 'end_turn', text('side')), isSidechain: true }])).toEqual({ _tag: 'Open' });
});

const grok = (seconds: number, update: Record<string, unknown>) => ({
  timestamp: Math.floor(START / 1000) + seconds,
  method: 'session/update',
  params: { update },
});
const chunk = (seconds: number, value: string) =>
  grok(seconds, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } });

test('Grok: turn_completed ends the run with the message streamed after the last tool call, and a cancelled stop reason aborts it', () => {
  const asked = grok(1, { sessionUpdate: 'user_message_chunk' });
  const body = [
    asked,
    chunk(2, 'I will run it'),
    grok(3, { sessionUpdate: 'tool_call' }),
    grok(4, { sessionUpdate: 'tool_call_update' }),
    chunk(5, 'DO'),
    chunk(5, 'NE'),
  ];
  expect(endOf('grok', [...body, grok(6, { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' })])).toEqual({
    _tag: 'Completed',
    message: 'DONE',
  });
  expect(endOf('grok', [...body, grok(6, { sessionUpdate: 'turn_completed', stop_reason: 'cancelled' })])).toEqual({ _tag: 'Aborted' });
  expect(endOf('grok', body)).toEqual({ _tag: 'Open' });
  expect(endOf('grok', [grok(-5, { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' }), asked])).toEqual({ _tag: 'Open' });
});

test('Grok: a turn completed in the same second the run began is still read, because seconds cannot order inside one', () => {
  const same = { ...grok(0, { sessionUpdate: 'turn_completed', stop_reason: 'cancelled' }), timestamp: Math.floor(START / 1000) };
  expect(endOf('grok', [same])).toEqual({ _tag: 'Aborted' });
});

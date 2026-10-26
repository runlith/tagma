import { expect, test } from 'bun:test';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import source from '../../testing/fixtures/claude-code/source.jsonl' with { type: 'text' };
import full from '../../testing/fixtures/claude-code/sdk-full.jsonl' with { type: 'text' };
import prefix from '../../testing/fixtures/claude-code/sdk-prefix.jsonl' with { type: 'text' };
import { terminalHistory } from '../../birth/seat.js';
import { turnAddresses } from './chain.js';
import { claudeCode } from './row.js';

const launch = claudeCode.launch;
const address = launch.address!;
const lines = source.split('\n');
const ROOT = 'c252b18d-e481-452e-8449-a632720da358';
const PROMPTS = [
  { line: 4, turn: 'da2c76e5-373f-4547-b1f1-f68f6e1dd7b8' },
  { line: 30, turn: '579e5e70-ecac-4ee4-bfd9-d89465af0d07' },
  { line: 37, turn: 'bb2b8958-0107-4823-a90e-b1e9513cfb5d' },
] as const;
const AFTER_A = 'cc2fcffe-4f56-4ca1-9bac-513e81529f44';
const AFTER_B = 'a8864188-8787-4656-afa4-53527ab81079';

const upTo = (line: number) => `${lines.slice(0, line).join('\n')}\n`;
const ofRun = (index: number, before = upTo(PROMPTS[index]!.line)) => address.of({ turn: PROMPTS[index]!.turn, before });
const forkedFrom = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { uuid?: string; forkedFrom?: { messageUuid: string } })
      .flatMap((row) => (row.uuid === undefined || row.forkedFrom === undefined ? [] : [[row.uuid, row.forkedFrom.messageUuid] as const])),
  );

test("a run's address is the last entry of the active chain before its prompt, read from a tail window", () => {
  expect(address.reads).toBe('transcript');
  expect(ofRun(0)).toBeNull();
  expect(address.of({ turn: PROMPTS[0].turn, before: null })).toBeNull();
  expect(ofRun(1)).toBe(AFTER_A);
  expect(ofRun(2)).toBe(AFTER_B);
  const window = upTo(PROMPTS[2].line);
  expect(ofRun(2, window.slice(window.indexOf(lines[30]!) + 20))).toBe(AFTER_B);
  expect(ofRun(1, upTo(PROMPTS[1].line + 2))).toBe(AFTER_A);
  expect(address.of({ turn: null, before: upTo(PROMPTS[1].line + 2) })).toBeNull();
});

test('sidechains, subagent entries and lines appended out of chain do not move the address', () => {
  const entry = (row: Record<string, unknown>) => JSON.stringify({ sessionId: ROOT, timestamp: '2026-10-25T00:00:00.000Z', ...row });
  const strays = [
    entry({ type: 'assistant', uuid: 'side-1', parentUuid: AFTER_B, isSidechain: true, message: { content: [] } }),
    entry({ type: 'user', uuid: 'team-1', parentUuid: AFTER_B, isSidechain: false, teamName: 'crew', message: { content: 'x' } }),
    entry({ type: 'progress', uuid: 'progress-1', parentUuid: AFTER_B }),
    entry({ type: 'system', uuid: 'orphan-1', parentUuid: null, subtype: 'informational' }),
  ];
  expect(ofRun(2, `${upTo(PROMPTS[2].line)}${strays.join('\n')}\n`)).toBe(AFTER_B);
});

test("the new root's turn addresses pair in order with the runs kept from the source", () => {
  const kept = PROMPTS.map((_, index) => ofRun(index));
  const copied = (text: string) => {
    const origin = forkedFrom(text);
    return turnAddresses(text).map((at) => (at === null ? null : origin.get(at)));
  };
  expect(turnAddresses(full)).toEqual([null, 'a363fc3f-c981-4f9f-8c86-1775634800bd', 'c9d4502b-6f0d-4d44-adb4-89299d9b9aad']);
  expect(copied(full)).toEqual(kept);
  expect(copied(prefix)).toEqual(kept.slice(0, 1));
});

test('both cuts are copies the vendor makes by preparing the new root through the cut server', () => {
  expect(terminalHistory('claude-code', false)).toEqual({ history: 'session', copies: { whole: 'vendor', point: 'vendor' } });
  expect(terminalHistory('claude-code', true).copies).toEqual({ whole: 'vendor', point: 'none' });
  const { whole, point } = launch.cut!;
  if (whole?._tag !== 'Prepare' || point?._tag !== 'Prepare' || typeof point.rows === 'string')
    throw new Error('Claude Code prepares both cuts');
  expect(point.server('/work')).toEqual({ program: WORLD_COMMAND, args: ['harness-run', 'claude-code', '--cut'] });
  expect(whole.fork.request({ root: ROOT, address: null }, '/work')).toEqual({
    method: 'fork',
    params: { root: ROOT, address: null, dir: '/work' },
  });
  expect(point.fork.request({ root: ROOT, address: AFTER_A }, '/work')).toEqual({
    method: 'fork',
    params: { root: ROOT, address: AFTER_A, dir: '/work' },
  });
  const answered = (value: unknown) => ({ _tag: 'Answered' as const, value });
  expect(point.fork.judge(answered({ sessionId: 'y', path: '/home/.claude/projects/w/y.jsonl' }))).toEqual({
    _tag: 'Accept',
    value: { id: 'y', artifact: '/home/.claude/projects/w/y.jsonl' },
  });
  expect(point.fork.judge(answered({ sessionId: 'y' }))).toMatchObject({ _tag: 'Refuse' });
  expect(point.fork.judge({ _tag: 'VendorError', code: -32002, message: 'gone' })).toMatchObject({
    _tag: 'Refuse',
    reason: expect.stringContaining('-32002'),
  });
  expect(point.rows.request('y')).toEqual({ method: 'turns', params: { root: 'y' } });
  expect(point.rows.judge(answered({ addresses: [null, AFTER_A] }))).toEqual({ _tag: 'Accept', value: [null, AFTER_A] });
  expect(point.rows.judge(answered({ addresses: [7] }))).toMatchObject({ _tag: 'Refuse' });
});

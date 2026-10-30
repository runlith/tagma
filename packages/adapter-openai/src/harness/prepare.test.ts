import { expect, test } from 'bun:test';
import { codexTerminal as codex } from './codex.js';
import forkRpc from '../testing/fixtures/fork-rpc.json';

const prepare = codex.launch.prepare!;
const whole = codex.launch.cut!.whole!;
const point = codex.launch.cut!.point!;
if (whole._tag !== 'Prepare' || point._tag !== 'Prepare' || typeof point.rows === 'string') throw new Error('Codex must prepare its cuts');
const turns = point.rows;
const source = '01a17329-1ae3-78a3-af25-aba70cf0f88a';
const turnIds = ['01a17329-1b4c-7971-b242-453487dd1265', '01a17329-25d7-7ac3-a0a8-23b0355703b3', '01a17329-29d8-7c73-8ef0-dc5356c7dc76'];
const answered = (value: unknown) => ({ _tag: 'Answered' as const, value });
const refused = (code: number, message = 'no') => ({ _tag: 'VendorError' as const, code, message });
const thread = (over: Record<string, unknown> = {}) => ({
  thread: { id: 'thread-1', path: '/home/sessions/r-thread-1.jsonl', ephemeral: false, historyMode: 'paginated', ...over },
});

test('the codex preparation asks the measured road in order', () => {
  expect(prepare.server('/work')).toEqual({ program: 'codex', args: ['app-server', '--stdio'] });
  expect(prepare.initialize.request({ name: 'tagma', version: '0.1.0' })).toEqual({
    method: 'initialize',
    params: { clientInfo: { name: 'tagma', version: '0.1.0' }, capabilities: { experimentalApi: true } },
  });
  expect(prepare.start.request('/work')).toEqual({ method: 'thread/start', params: { cwd: '/work' } });
  expect(prepare.read.request('thread-1')).toEqual({ method: 'thread/read', params: { threadId: 'thread-1', includeTurns: true } });
});

test('a handshake that is no object refuses; a vendor refusal names its code', () => {
  expect(prepare.initialize.judge(answered({ userAgent: 'codex' }))).toEqual({ _tag: 'Accept', value: undefined });
  expect(prepare.initialize.judge(answered(null))).toMatchObject({ _tag: 'Refuse' });
  expect(prepare.initialize.judge(refused(-32600, 'bad'))).toMatchObject({ _tag: 'Refuse', reason: expect.stringContaining('-32600') });
});

test('a start yields the id and artifact it names, and nothing unmeasured proceeds', () => {
  expect(prepare.start.judge(answered(thread()))).toEqual({
    _tag: 'Accept',
    value: { id: 'thread-1', artifact: '/home/sessions/r-thread-1.jsonl' },
  });
  expect(prepare.start.judge(answered(thread({ id: '' })))).toMatchObject({ _tag: 'Refuse' });
  expect(prepare.start.judge(answered(thread({ path: undefined })))).toMatchObject({ _tag: 'Refuse' });
  expect(prepare.start.judge(answered(thread({ ephemeral: true })))).toMatchObject({
    _tag: 'Refuse',
    reason: expect.stringContaining('ephemeral'),
  });
  expect(prepare.start.judge(answered(thread({ historyMode: 'legacy' })))).toMatchObject({
    _tag: 'Refuse',
    reason: expect.stringContaining('paginated'),
  });
  expect(prepare.start.judge(answered({}))).toMatchObject({ _tag: 'Refuse' });
  expect(prepare.start.judge(refused(-32603, 'boom'))).toMatchObject({ _tag: 'Refuse', reason: expect.stringContaining('-32603') });
});

test('whole and point forks use the experimental road and accept the recorded durable roots', () => {
  expect(whole.fork.request({ root: source, address: null }, '/work')).toEqual({ method: 'thread/fork', params: { threadId: source } });
  expect(point.fork.request({ root: source, address: turnIds[1]! }, '/work')).toEqual({
    method: 'thread/fork',
    params: { threadId: source, beforeTurnId: turnIds[1] },
  });
  expect(point.fork.judge(answered(forkRpc.cut))).toEqual({
    _tag: 'Accept',
    value: { id: forkRpc.cut.thread.id, artifact: forkRpc.cut.thread.path },
  });
  expect(whole.fork.judge(answered(forkRpc.whole))).toEqual({
    _tag: 'Accept',
    value: { id: forkRpc.whole.thread.id, artifact: forkRpc.whole.thread.path },
  });
  for (const over of [{ id: '' }, { path: null }, { ephemeral: true }, { historyMode: 'legacy' }])
    expect(point.fork.judge(answered({ thread: { ...forkRpc.cut.thread, ...over } }))).toMatchObject({ _tag: 'Refuse' });
  expect(point.fork.judge(refused(-32602, 'bad cutoff'))).toMatchObject({ _tag: 'Refuse', reason: expect.stringContaining('-32602') });
});

test('fork rows follow thread/read order, including inherited turns absent from the child rollout', () => {
  expect(turns.request(forkRpc.whole.thread.id)).toEqual({
    method: 'thread/read',
    params: { threadId: forkRpc.whole.thread.id, includeTurns: true },
  });
  expect(turns.judge(answered(forkRpc.wholeRead))).toEqual({ _tag: 'Accept', value: turnIds });
  expect(turns.judge(answered(forkRpc.cutRead))).toEqual({ _tag: 'Accept', value: turnIds.slice(0, 1) });
  expect(turns.judge(answered({ thread: { turns: [] } }))).toEqual({ _tag: 'Accept', value: [] });
  expect(turns.judge(answered({ thread: { turns: [{ id: turnIds[0] }, {}] } }))).toMatchObject({ _tag: 'Refuse' });
  expect(turns.judge(refused(-32601))).toMatchObject({ _tag: 'Refuse' });
});

test('the materializing read accepts empty turns and the measured -32601, and refuses the rest', () => {
  expect(prepare.read.judge(answered({ thread: { turns: [] } }))).toEqual({ _tag: 'Accept', value: undefined });
  expect(prepare.read.judge(refused(-32601, 'list_turns is not supported yet'))).toEqual({ _tag: 'Accept', value: undefined });
  expect(prepare.read.judge(answered({ thread: { turns: [{ id: 't' }] } }))).toMatchObject({
    _tag: 'Refuse',
    reason: expect.stringContaining('1 turn(s)'),
  });
  expect(prepare.read.judge(answered({ thread: {} }))).toMatchObject({ _tag: 'Refuse' });
  expect(prepare.read.judge(refused(-32600, 'bad'))).toMatchObject({ _tag: 'Refuse', reason: expect.stringContaining('-32600') });
});

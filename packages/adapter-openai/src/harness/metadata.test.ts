import { expect, test } from 'bun:test';
import { MetadataInvalid, type MetadataSession } from '@runlith/tagma/adapter/metadata';
import { codexTerminal } from './codex.js';

const metadata = codexTerminal.metadata!;
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const session = (rootKey: string, transcriptPath?: string): MetadataSession => ({
  rootKey,
  cwd: '/work/proj',
  transcriptPath,
  storage: { entries: [{ name: 'HOME', value: '/home' }] },
});

test('recorded effort and titles join exact ids without inventing missing effort', () => {
  const reader = metadata.artifact!.fold('codex-one');
  let value = reader.line(reader.empty(), line({ type: 'session_meta', payload: { id: 'codex-one', session_id: 'codex-one' } }));
  value = reader.line(value, line({ type: 'turn_context', payload: { turn_id: 'turn-one', model: 'gpt-5.6-luna', effort: 'low' } }));
  expect(value).toMatchObject({
    model: { value: 'gpt-5.6-luna', turnId: 'turn-one', claim: 'last-recorded' },
    effort: { value: 'low', turnId: 'turn-one' },
  });
  value = reader.line(value, line({ type: 'turn_context', payload: { turn_id: 'turn-two', model: 'gpt-5.6-luna' } }));
  expect(value).toMatchObject({ effort: null });
  expect(() => reader.line(reader.empty(), line({ type: 'session_meta', payload: { id: 'codex-two' } }))).toThrow(MetadataInvalid);
  const index = metadata.sources(session('codex-one'))[0]!;
  if (index.kind !== 'index') throw new Error('expected an index');
  expect(index.parse(line({ id: 'codex-one', thread_name: 'One' }))).toEqual({ id: 'codex-one', title: 'One' });
});

test('a skipped envelope counts only when it could carry model or effort', () => {
  const reader = metadata.artifact!.fold('codex-one');
  const envelope = (type: string) => JSON.stringify({ timestamp: '2026-07-04T15:23:22.553Z', ordinal: 4, type, payload: {} });
  expect(reader.missed!(envelope('compacted'))).toEqual([]);
  expect(reader.missed!(envelope('turn_context'))).toEqual(['model', 'effort']);
});

test('rollout sources accept thread/revert files and refuse foreign sessions', () => {
  const base = '/home/.codex/sessions/2026/09/01/rollout-2026-09-01T00-00-00-';
  expect(metadata.sources(session('codex-one', `${base}codex-one.jsonl`))[1]).toMatchObject({ kind: 'file' });
  expect(metadata.sources(session('codex-one', `${base}codex-one_0192abcd.jsonl`))[1]).toMatchObject({ kind: 'file' });
  for (const tail of ['codex-two.jsonl', 'xcodex-one.jsonl', 'codex-one.txt'])
    expect(metadata.sources(session('codex-one', `${base}${tail}`))[1]).toMatchObject({
      kind: 'unreadable',
      reason: 'session-identity-mismatch',
    });
});

test('user input_text is read under the session its meta names, with developer context and assistant text excluded', () => {
  const reader = metadata.words!.sources(session('codex-1', '/home/r.jsonl'))[0]!.fold;
  const rows = [
    { type: 'session_meta', payload: { id: 'codex-1' } },
    {
      type: 'response_item',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>' }] },
    },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'name this thread' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } },
  ];
  const value = rows.reduce((value, row) => reader.line(value, line(row)), reader.empty());
  expect(value.said.flatMap((said) => said.texts)).toEqual(['name this thread']);
  expect(() => reader.line(reader.empty(), line({ type: 'session_meta', payload: { id: 'codex-2' } }))).toThrow(MetadataInvalid);
});

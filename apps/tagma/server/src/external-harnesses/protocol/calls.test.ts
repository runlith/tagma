import { expect, test } from 'bun:test';
import type { ToolCall, ToolCallUpdate } from '@runlith/acp/toolCalls';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { amendedEntry, bounded, callEntry } from './calls.js';

const AT = '2026-10-08T12:00:00.000Z';

const entryOf = (call: ToolCall, cwd: string | null = null) => callEntry('turn-1', call, AT, cwd);

const amend = (standing: ThreadToolEntry, update: ToolCallUpdate, cwd: string | null = null): ThreadToolEntry => {
  const entry = amendedEntry(standing, update, AT, cwd);
  if (entry === null) throw new Error('the standing record was unreadable');
  return entry;
};

const filesOf = (entry: ThreadToolEntry) => (entry.toolDisplay?.form === 'diff' ? entry.toolDisplay.files : []);

test('an observed MCP answer retains its declared thread address without resolving the vendor’s tool name', () => {
  const target = { kind: 'agent', address: 'child', id: 'child', projectId: 7 } as const;
  const answer = { status: 'stopped', threadId: 'child', projectId: 7, _meta: { toolDisplay: { form: 'none', reference: target } } };
  const entry = entryOf({
    toolCallId: 'mcp-call',
    title: 'vendor operation',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(answer) } }],
  });
  expect(entry.toolState).toBe('output-available');
  expect(entry.toolDisplay?.reference).toEqual(target);
});

test('an edit call projects as a settled native entry whose display is the patch of its diff, with its places as details', () => {
  const entry = entryOf({
    toolCallId: 'call-1',
    title: 'Edit /repo/src/a.ts',
    kind: 'edit',
    status: 'completed',
    rawInput: { file_path: '/repo/src/a.ts' },
    content: [
      { type: 'diff', path: '/repo/src/a.ts', oldText: 'one\ntwo\n', newText: 'one\n2\n' },
      { type: 'content', content: { type: 'text', text: 'The file was updated.' } },
    ],
    locations: [{ path: '/repo/src/a.ts', line: 2 }],
    rawOutput: { ok: true },
  });
  expect(entry).toMatchObject({
    id: 'tool:turn-1:call-1',
    toolName: 'Edit /repo/src/a.ts',
    toolState: 'output-available',
    toolOutput: { rawOutput: { ok: true } },
    toolDisplay: {
      form: 'diff',
      mutates: true,
      details: [{ label: 'file', value: '/repo/src/a.ts:2' }],
      files: [{ path: '/repo/src/a.ts', added: 1, removed: 1 }],
    },
  });
  expect(entry.toolDisplay?.form === 'diff' ? entry.toolDisplay.files[0].patch : '').toContain('+2');
});

test('a call carrying several diffs keeps one file per diff in the order the agent gave them', () => {
  const entry = entryOf({
    toolCallId: 'call-2',
    title: 'apply_patch',
    kind: 'edit',
    status: 'completed',
    content: [
      { type: 'diff', path: '/repo/a.ts', oldText: null, newText: 'a' },
      { type: 'diff', path: '/repo/b.ts', oldText: 'x\n', newText: 'y\n' },
    ],
  });
  expect(entry.toolDisplay).toMatchObject({
    form: 'diff',
    files: [
      { path: '/repo/a.ts', added: 1, removed: 0 },
      { path: '/repo/b.ts', added: 1, removed: 1 },
    ],
  });
});

test('a read call shows the text it returned, and a running call settles later', () => {
  const running = entryOf({ toolCallId: 'call-3', title: 'Read a.ts', kind: 'read', status: 'in_progress' });
  expect(running).toMatchObject({ toolState: 'input-available', toolDisplay: { form: 'none' } });
  expect(running.toolDisplay?.mutates).toBeUndefined();

  const done = amend(running, {
    toolCallId: 'call-3',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'const a = 1;' } }],
    locations: [{ path: '/repo/a.ts' }],
  });
  expect(done).toMatchObject({
    toolState: 'output-available',
    toolDisplay: { form: 'text', text: 'const a = 1;', details: [{ label: 'file', value: '/repo/a.ts' }] },
  });
});

test('a failed call settles as an error carrying the words the agent gave, else its raw output, and its display does not carry them again', () => {
  const said = entryOf({
    toolCallId: 'call-4',
    title: 'Run tests',
    kind: 'execute',
    status: 'failed',
    content: [{ type: 'content', content: { type: 'text', text: 'exit 1: two tests failed' } }],
    rawOutput: { exit: 1 },
  });
  expect(said).toMatchObject({
    toolState: 'output-error',
    toolError: 'exit 1: two tests failed',
    toolDisplay: { form: 'none', mutates: true },
  });

  const raw = entryOf({ toolCallId: 'call-5', title: 'Run tests', status: 'failed', rawOutput: { exit: 1 } });
  expect(raw).toMatchObject({ toolState: 'output-error', toolError: '{"exit":1}', toolDisplay: { form: 'none' } });
});

test('a late update that carries only places keeps the diff the call already showed', () => {
  const ended = entryOf({
    toolCallId: 'call-6',
    title: 'Write b.ts',
    kind: 'edit',
    status: 'completed',
    content: [{ type: 'diff', path: '/repo/b.ts', oldText: null, newText: 'b\n' }],
  });
  const amended = amend(ended, { toolCallId: 'call-6', locations: [{ path: '/repo/b.ts', line: 1 }] });
  expect(amended).toMatchObject({
    toolState: 'output-available',
    toolDisplay: { form: 'diff', mutates: true, details: [{ label: 'file', value: '/repo/b.ts:1' }], files: [{ path: '/repo/b.ts' }] },
  });
});

test('a late update arriving after a turn closed a running call keeps what the call already showed, and one carrying only its kind marks it mutating', () => {
  const running = entryOf({
    toolCallId: 'call-7',
    title: 'Write c.ts',
    status: 'in_progress',
    content: [{ type: 'diff', path: '/repo/c.ts', oldText: null, newText: 'c' }],
  });
  expect(running.toolDisplay?.mutates).toBeUndefined();

  const kinded = amend(running, { toolCallId: 'call-7', kind: 'edit' });
  expect(kinded).toMatchObject({
    toolState: 'input-available',
    toolDisplay: { form: 'diff', mutates: true, files: [{ path: '/repo/c.ts' }] },
  });

  const done = amend(kinded, { toolCallId: 'call-7', status: 'completed' });
  expect(done).toMatchObject({
    toolState: 'output-available',
    toolDisplay: { form: 'diff', mutates: true, files: [{ path: '/repo/c.ts' }] },
  });
});

test('paths under the session directory read relative to it, as native paths do', () => {
  const entry = entryOf(
    {
      toolCallId: 'call-8',
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      content: [{ type: 'diff', path: '/repo/src/a.ts', oldText: 'x', newText: 'y' }],
      locations: [{ path: '/repo/src/a.ts', line: 1 }, { path: '/elsewhere/b.ts' }],
    },
    '/repo',
  );
  expect(entry.toolDisplay).toMatchObject({
    files: [{ path: 'src/a.ts' }],
    details: [
      { label: 'file', value: 'src/a.ts:1' },
      { label: 'file', value: '/elsewhere/b.ts' },
    ],
  });
});

test('a call that gave no diff, words or terminal shows its raw output as text', () => {
  const entry = entryOf({ toolCallId: 'call-9', title: 'Count', status: 'completed', rawOutput: { lines: 3 } });
  expect(entry.toolDisplay).toMatchObject({ form: 'text', text: '{\n  "lines": 3\n}' });
});

test('a diff the agent sends again is not computed again, whether a late update leaves content out or the completing one repeats it', () => {
  const running = entryOf({
    toolCallId: 'call-10',
    title: 'Edit a.ts',
    kind: 'edit',
    status: 'in_progress',
    content: [{ type: 'diff', path: '/repo/a.ts', oldText: 'one\ntwo\n', newText: 'one\n2\n' }],
  });
  const [shown] = filesOf(running);

  const repeated = amend(running, {
    toolCallId: 'call-10',
    status: 'completed',
    content: [
      { type: 'diff', path: '/repo/a.ts', oldText: 'one\ntwo\n', newText: 'one\n2\n' },
      { type: 'content', content: { type: 'text', text: 'Updated.' } },
    ],
  });
  expect(filesOf(repeated)[0]).toBe(shown);

  const placed = amend(repeated, { toolCallId: 'call-10', locations: [{ path: '/repo/a.ts' }] });
  expect(filesOf(placed)[0]).toBe(shown);
});

test('a late update to a call whose record cannot be read is refused, not applied over nothing', () => {
  const unreadable: ThreadToolEntry = {
    ...entryOf({ toolCallId: 'call-11', title: 'Read', status: 'completed' }),
    toolOutput: 'plain words',
  };
  expect(amendedEntry(unreadable, { toolCallId: 'call-11', status: 'failed' }, AT, null)).toBeNull();
});

test('a tool payload over the native output cap is kept as a bounded preview', () => {
  const huge = { lines: 'x'.repeat(200_000) };
  const kept = bounded(huge) as { truncated: boolean; preview: { lines: string } };
  expect(kept.truncated).toBe(true);
  expect(JSON.stringify(kept).length).toBeLessThan(60_000);
  expect(bounded({ small: 1 })).toEqual({ small: 1 });
});

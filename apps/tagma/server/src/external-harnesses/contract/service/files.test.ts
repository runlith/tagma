import { expect, test } from 'bun:test';
import { builtinHarness } from '../../testing/builtin.js';

const codexFiles = builtinHarness('codex').filesOf;
const claudeFiles = builtinHarness('claude-code').filesOf;

const VENDOR_EXAMPLE = [
  '*** Begin Patch',
  '*** Add File: hello.txt',
  '+Hello world',
  '*** Update File: src/app.py',
  '*** Move to: src/main.py',
  '@@ def greet():',
  '-print("Hi")',
  '+print("Hello, world!")',
  '*** Delete File: obsolete.txt',
  '*** End Patch',
].join('\n');

test('a patch envelope names every file it touches, with what it did to each', () => {
  expect(codexFiles({ tool_name: 'apply_patch', tool_input: { command: VENDOR_EXAMPLE } })).toEqual([
    { effect: 'write', path: 'hello.txt' },
    { effect: 'move', path: 'src/main.py', from: 'src/app.py' },
    { effect: 'delete', path: 'obsolete.txt' },
  ]);
});

test('the add-only envelope the corpus captured names its file', () => {
  const command = '*** Begin Patch\n*** Add File: /tmp/workspace/patch.txt\n+ok\n*** End Patch';
  expect(codexFiles({ tool_name: 'apply_patch', tool_input: { command } })).toEqual([
    { effect: 'write', path: '/tmp/workspace/patch.txt' },
  ]);
});

test('a Claude-shaped tool names its one file, and only the read one reads', () => {
  expect(claudeFiles({ tool_name: 'Read', tool_input: { file_path: '/w/a.ts' } })).toEqual([{ effect: 'read', path: '/w/a.ts' }]);
  expect(claudeFiles({ tool_name: 'read', tool_input: { file_path: '/w/a.ts' } })).toEqual([{ effect: 'read', path: '/w/a.ts' }]);
  expect(claudeFiles({ tool_name: 'Write', tool_input: { file_path: '/w/a.ts' } })).toEqual([{ effect: 'write', path: '/w/a.ts' }]);
  expect(claudeFiles({ tool_name: 'multiedit', tool_input: { file_path: '/w/a.ts' } })).toEqual([{ effect: 'write', path: '/w/a.ts' }]);
});

test('an event about no file names none', () => {
  expect(claudeFiles({ tool_name: 'shell', tool_input: { command: 'ls -la' } })).toEqual([]);
  expect(claudeFiles({ hook_event_name: 'Stop', session_id: 'abc' })).toEqual([]);
  expect(codexFiles({ tool_name: 'apply_patch', tool_input: { command: '*** Add File:   \n' } })).toEqual([]);
});

import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@runlith/agent/tool';
import { toolPartialDisplay } from '@runlith/agent/tool';
import { readPartialJsonState } from '@runlith/utils/json';
import { createTools } from './index';
import { unruledTimes } from './CommandWork';
import { machineWorld } from './world/machine';
import type { World } from './world';
import type { ToolFactoryOptions } from './workspace';

const options = <W extends World = typeof machineWorld>(
  overrides: Omit<Partial<ToolFactoryOptions>, 'world'> & { cwd: string; world?: W },
): ToolFactoryOptions & { world: W } => {
  const { world, ...rest } = overrides;
  return { commandTimes: unruledTimes, searchMs: 25_000, ...rest, world: (world ?? machineWorld) as W };
};

const cwd = await mkdtemp(join(tmpdir(), 'streamed-subject-'));
const tools = createTools(options({ cwd }));

function titleAt(tool: Tool, text: string): string | undefined {
  const state = readPartialJsonState(text);
  if (!state) throw new Error(`The partial input was unreadable: ${text}`);
  return toolPartialDisplay(tool, state)?.title;
}

test('a streaming edit names its file before any of the replacement text arrives', () => {
  const path = join(cwd, 'src', 'owner.ts');
  expect(titleAt(tools.edit!, `{"path":"${path}","oldString":"const a = 1;\\nconst b`)).toBe('src/owner.ts');
  expect(titleAt(tools.edit!, `{"path":"${join(cwd, 'src', 'ow')}`)).toBeUndefined();
});

test('a streaming write names its file before its content, whatever the content costs to dictate', () => {
  const path = join(cwd, 'notes.md');
  expect(titleAt(tools.write!, `{"path":"${path}","content":"# A long document that is still`)).toBe('notes.md');
});

test('a running search, fetch or listing names what it asked for before any answer', () => {
  expect(titleAt(tools.websearch!, `{"query":"bun pricing","numRes`)).toBe('bun pricing');
  expect(titleAt(tools.webfetch!, `{"url":"https://bun.sh","form`)).toBe('https://bun.sh');
  expect(titleAt(tools.grep!, `{"pattern":"toolDisplay","path":"${join(cwd, 'src')}/ow`)).toBe('toolDisplay');
  expect(titleAt(tools.glob!, `{"pattern":"**/*.ts","path`)).toBe('**/*.ts');
  expect(titleAt(tools.ls!, `{"path":"${join(cwd, 'lib')}","lim`)).toBe('lib');
});

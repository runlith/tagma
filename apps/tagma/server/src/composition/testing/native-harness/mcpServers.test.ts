import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Effect } from 'effect';
import { mcpToolIdentity, mcpToolNamed } from '@runlith/mcp/identity';
import type { McpServers } from '../../../mcp/contract/service/servers.js';
import { mcpBoundTools, mcpServerTools, asMcpToolsContext, RETRIEVAL_WORDS } from '../../../native-harness/testing/doubles.js';

import { COLLABORATION_WORDS } from '@runlith/agent/collaboration/words';
import { SKILL_WORDS } from '@runlith/agent/skillWords';
import { WORKSPACE_WORDS } from '@runlith/agent-tools/words';
import { collectedOperations } from '../../manifest.js';

const declaration = (name: string): McpServerDeclaration => ({
  name,
  transport: 'stdio',
  command: 'echo',
  capabilities: { kinds: [], mutates: false },
  enabled: true,
});

const descriptor = (name: string) => ({
  name,
  inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
});

const contextOf = (palette: ReturnType<McpServers['Service']['palette']>, bound = mcpBoundTools()): ReturnType<typeof asMcpToolsContext> =>
  ({
    projectId: 1,
    workingRoot: '/workspace',
    caller: { files: null },
    thread: { id: 'thread-1' },
    mcp: () => palette,
    mcpBound: bound,
    mcpServers: { caller: () => ({ call: () => Effect.die('no call in this case') }) },
  }) as unknown as ReturnType<typeof asMcpToolsContext>;

test('every tool of a server is offered under mcp__<server>__<tool>', () => {
  const catalog = mcpServerTools(
    contextOf([{ declaration: declaration('context7'), descriptors: [descriptor('resolve-library-id')] as never }]),
  );
  expect(Object.keys(catalog)).toEqual(['mcp__context7__resolve-library-id']);
  expect(catalog['mcp__context7__resolve-library-id']?.exposure).toBe('deferred');
});

test('two servers publishing one tool name both stand, told apart by their prefixes', () => {
  const catalog = mcpServerTools(
    contextOf([
      { declaration: declaration('files'), descriptors: [descriptor('search')] as never },
      { declaration: declaration('docs'), descriptors: [descriptor('search')] as never },
    ]),
  );
  expect(Object.keys(catalog).sort()).toEqual(['mcp__docs__search', 'mcp__files__search']);
});

test('a palette with nothing connected yields no tools at all', () => {
  expect(mcpServerTools(contextOf([]))).toEqual({});
});

it.effect('a server named after a built-in shadows no built-in tool name', () =>
  Effect.gen(function* () {
    const builtIn: readonly string[] = [
      ...new Set([
        ...(yield* collectedOperations).declarations.map((declaration) => declaration.id),
        ...Object.keys(WORKSPACE_WORDS),
        ...Object.keys(SKILL_WORDS),
        ...Object.keys(RETRIEVAL_WORDS()),
        ...Object.keys(COLLABORATION_WORDS),
      ]),
    ];
    const catalog = mcpServerTools(
      contextOf([
        {
          declaration: declaration('read_block'),
          descriptors: builtIn.map((name) => descriptor(name)) as never,
        },
      ]),
    );
    expect(Object.keys(catalog)).toHaveLength(builtIn.length);
    expect(Object.keys(catalog).filter((name) => builtIn.includes(name as never))).toEqual([]);
    expect(catalog['mcp__read_block__read_block']).toBeDefined();
  }),
);

test('the names this run was bound with are remembered for the thread that is being built', () => {
  const bound = mcpBoundTools();
  mcpServerTools(contextOf([{ declaration: declaration('files'), descriptors: [descriptor('search')] as never }], bound));
  expect(bound.of('thread-1')).toEqual(['mcp__files__search']);
  mcpServerTools(contextOf([], bound));
  expect(bound.of('thread-1')).toEqual([]);
});

test('every offered tool is keyed by the name its identity composes, and reads back as its own pair', () => {
  const catalog = mcpServerTools(
    contextOf([
      { declaration: declaration('files'), descriptors: [descriptor('read__all')] as never },
      { declaration: declaration('docs'), descriptors: [descriptor('search')] as never },
    ]),
  );
  for (const name of Object.keys(catalog)) {
    const pair = mcpToolNamed(name);
    expect(pair).not.toBeNull();
    expect(mcpToolIdentity(pair?.server ?? '', pair?.tool ?? '')).toMatchObject({
      _tag: 'named',
      identity: { name },
    });
  }
  expect(Object.keys(catalog).sort()).toEqual(['mcp__docs__search', 'mcp__files__read__all']);
});

test('a descriptor this client cannot name is absent from the catalog, and its neighbours stand', () => {
  const hostile = ['__proto__', 'constructor', 'toString', 'read/private', 'x'.repeat(200)];
  const catalog = mcpServerTools(
    contextOf([
      {
        declaration: declaration('files'),
        descriptors: [...hostile.map((name) => descriptor(name)), descriptor('read')] as never,
      },
    ]),
  );
  expect(Object.getPrototypeOf(catalog)).toBe(Object.prototype);
  expect(Object.hasOwn(catalog, 'mcp__files__read')).toBe(true);
  expect(Object.keys(catalog)).not.toContain('mcp__files__read/private');
  expect(Object.keys(catalog).some((name) => name.length > 64)).toBe(false);
});

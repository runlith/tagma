import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { AgentRuleContext } from '@runlith/agent/AgentRuntimePolicy';
import { mcpRule, McpBoundTools, type McpRuleContext } from './mcpRule.js';
import type { McpServers } from '../../mcp/contract/service/servers.js';

const declaration = (name: string): McpServerDeclaration => ({
  name,
  transport: 'stdio',
  command: 'echo',
  capabilities: { kinds: [], mutates: false },
  enabled: true,
});

const connected = (names: readonly string[]): ReturnType<McpServers['Service']['palette']> =>
  names.map((name) => ({ declaration: declaration(name), descriptors: [] }));

const rule = mcpRule<McpRuleContext>();
const binding = { threadId: 'thread-1', runId: 'run-1', projectId: 1 };

const step = (
  bound: McpBoundTools,
  palette: ReturnType<McpServers['Service']['palette']>,
  hook = 'beforeStep',
): AgentRuleContext<McpRuleContext> =>
  ({
    hook,
    thread: { id: 'thread-1' },
    projectId: 1,
    runId: 'run-1',
    mcp: () => palette,
    mcpBound: bound,
  }) as unknown as AgentRuleContext<McpRuleContext>;

const boundWith = (...names: readonly string[]): McpBoundTools => {
  const bound = new McpBoundTools();
  bound.bound(binding, names);
  return bound;
};

it.effect('a server that is no longer connected has its tools excluded, and only its own', () =>
  Effect.gen(function* () {
    const bound = boundWith('mcp__files__read', 'mcp__files__write', 'mcp__docs__search');
    expect(yield* rule(step(bound, connected(['docs'])))).toEqual({
      type: 'exclude',
      tools: ['mcp__files__read', 'mcp__files__write'],
    });
  }),
);

it.effect('it is silent while every server the run was built with is up', () =>
  Effect.gen(function* () {
    expect(yield* rule(step(boundWith('mcp__files__read'), connected(['files'])))).toBeNull();
  }),
);

it.effect('a server that comes back stops being excluded', () =>
  Effect.gen(function* () {
    const bound = boundWith('mcp__files__read');
    expect(yield* rule(step(bound, connected([])))).toEqual({ type: 'exclude', tools: ['mcp__files__read'] });
    expect(yield* rule(step(bound, connected(['files'])))).toBeNull();
  }),
);

it.effect('a thread whose run bound no MCP tool answers without reading the palette', () =>
  Effect.gen(function* () {
    const never = () => {
      throw new Error('the palette must not be read when nothing was bound');
    };
    expect(
      yield* rule({
        hook: 'beforeStep',
        thread: { id: 'thread-1' },
        projectId: 1,
        runId: 'run-1',
        mcp: never,
        mcpBound: new McpBoundTools(),
      } as never),
    ).toBeNull();
  }),
);

it.effect('it answers on beforeStep alone', () =>
  Effect.gen(function* () {
    expect(yield* rule(step(boundWith('mcp__files__read'), connected([]), 'afterStep'))).toBeNull();
  }),
);

it.effect('a thread the harness forgot leaves no ledger entry behind it', () =>
  Effect.gen(function* () {
    const bound = boundWith('mcp__files__read');
    expect(bound.of(binding)).toEqual(['mcp__files__read']);
    bound.forget('thread-1');
    expect(bound.of(binding)).toEqual([]);
    expect(yield* rule(step(bound, connected([])))).toBeNull();
  }),
);

import type { ToolCaller } from '@runlith/agent/contracts';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { resolve } from 'node:path';
import { Tool } from '@runlith/agent/tool';
import { Effect } from 'effect';
import { MCP_CALLER_META_KEY, type McpCaller } from './mcpCallerMeta';
import { McpPool } from './McpPool';
import type { McpStdioServerDeclaration } from './McpServerDeclaration';
import { mcpAnswer, mcpToolCatalog } from './mcpToolCatalog';

const unthreadedCaller: ToolCaller = { agentId: 'agent', ownerId: 'owner', thread: null };
const files: McpStdioServerDeclaration = {
  name: 'files',
  transport: 'stdio',
  command: process.execPath,
  args: [resolve(import.meta.dir, '../test/mcpTestServer.ts')],
  capabilities: { kinds: ['network'], mutates: false },
  enabled: true,
};

it.live(
  'the catalog carries callers over stdio and serves the published schema, text and refusals',
  () =>
    Effect.gen(function* () {
      const pool = yield* McpPool.make();
      yield* pool.reconcile([files]);
      yield* pool.call('files', 'pid', {});
      const entry = pool.paletteUnsafe()[0];
      const catalog = mcpToolCatalog({ projectId: 5, declaration: files, descriptors: entry?.descriptors ?? [], pool }).tools;
      const call = (name: string, args: Record<string, unknown>, caller = unthreadedCaller) => {
        const tool = catalog[name];
        if (tool === undefined) throw new Error(`no tool ${name}`);
        const execute = Tool.toolExecute(tool);
        if (execute === null) throw new Error(`tool ${name} has no body`);
        return execute(args, { toolCallId: 'call-1', caller, messages: [] });
      };
      const operator: McpCaller = { kind: 'operator', projectId: 5, view: 'poker.table', threadId: 'thread-7', bindings: { poker: 't3' } };
      const tagma: McpCaller = { kind: 'tagma', projectId: null, reason: 'scheduled' };
      const caller: ToolCaller = {
        agentId: 'agent',
        ownerId: 'owner',
        thread: { threadId: 'thread-7', runId: 'run-3', bindings: { poker: 't3/s5' } },
      };
      const threaded = yield* call('meta', { caller: operator, projectId: 99 }, caller);
      const unthreaded = yield* call('meta', {});
      const metaOf = (answer: { readonly value: unknown }) => JSON.parse(String(answer.value));
      expect(metaOf(threaded as Tool.ToolAnswer)[MCP_CALLER_META_KEY]).toEqual({ kind: 'agent', projectId: 5, ...caller });
      expect(metaOf(unthreaded as Tool.ToolAnswer)[MCP_CALLER_META_KEY]).toEqual({ kind: 'agent', projectId: 5, ...unthreadedCaller });
      expect(metaOf(mcpAnswer(yield* pool.call('files', 'meta', {}, { caller: operator })))[MCP_CALLER_META_KEY]).toEqual(operator);
      expect(metaOf(mcpAnswer(yield* pool.call('files', 'meta', {}, { caller: tagma })))[MCP_CALLER_META_KEY]).toEqual(tagma);
      expect(catalog.search?.inputSchema).toMatchObject({
        type: 'object',
        properties: { q: { type: 'string' }, background: { type: 'boolean' } },
        required: ['q'],
      });
      const refused = yield* Effect.result(call('search', {}));
      expect(refused._tag === 'Failure' && refused.failure._tag).toBe('Tool.Failed');
      expect(refused._tag === 'Failure' && refused.failure.reason).toContain('q is required');
      const answered = yield* call('echo', { text: 'hello' });
      const failed = yield* call('fail', { text: 'no match' });
      expect(answered).toBeInstanceOf(Tool.ToolAnswer);
      expect((answered as Tool.ToolAnswer).value).toBe('hello');
      expect((answered as Tool.ToolAnswer).display).toMatchObject({ form: 'text', text: 'hello' });
      expect((answered as Tool.ToolAnswer).verdict).toEqual({ kind: 'answered' });
      expect((failed as Tool.ToolAnswer).display).toMatchObject({ form: 'text', text: 'no match' });
      expect((failed as Tool.ToolAnswer).verdict).toMatchObject({ kind: 'refused', refusal: { code: 'failed', reason: 'no match' } });
    }),
  15_000,
);

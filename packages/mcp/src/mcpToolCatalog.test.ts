import type { ToolCaller } from '@runlith/agent/contracts';
import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Tool } from '@runlith/agent/tool';
import { Effect } from 'effect';
import { McpNotConnected } from './McpFailure';
import type { McpStdioServerDeclaration } from './McpServerDeclaration';
import { mcpAnswer, mcpToolCatalog } from './mcpToolCatalog';

const caller: ToolCaller = { agentId: 'agent', ownerId: 'owner', thread: null };
const declaration: McpStdioServerDeclaration = {
  name: 'files',
  transport: 'stdio',
  command: 'server',
  enabled: true,
  capabilities: { kinds: ['network'], mutates: false, tools: { grow: { kinds: ['write'], mutates: true } } },
};
const pool = { call: () => Effect.fail(new McpNotConnected({ server: 'files', state: 'failed' })) };

describe('mcpAnswer', () => {
  test('joins text parts and carries structuredContent beside them', () => {
    expect(mcpAnswer({ content: [{ type: 'text', text: 'no match' }], isError: true })).toEqual({
      value: 'no match',
      text: 'no match',
      failed: true,
      media: [],
    });
    expect(mcpAnswer({ content: [{ type: 'text', text: '{"n":1}' }], structuredContent: { n: 1 } })).toEqual({
      value: { text: '{"n":1}', structuredContent: { n: 1 } },
      text: '{"n":1}',
      failed: false,
      media: [],
    });
  });
  test('speaks the structure when a server sent structure and no text', () => {
    expect(mcpAnswer({ content: [], structuredContent: { n: 1, ok: true } })).toEqual({
      value: { text: '{"n":1,"ok":true}', structuredContent: { n: 1, ok: true } },
      text: '{"n":1,"ok":true}',
      failed: false,
      media: [],
    });
    expect(mcpAnswer({ content: [{ type: 'text', text: '' }], structuredContent: { n: 2 }, isError: true })).toEqual({
      value: { text: '{"n":2}', structuredContent: { n: 2 } },
      text: '{"n":2}',
      failed: true,
      media: [],
    });
  });
  test('decodes image bytes for the door while audio stays named', () => {
    const answered = mcpAnswer({
      content: [
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        { type: 'audio', data: 'BBBB', mimeType: 'audio/wav' },
      ],
    });
    expect(answered.failed).toBe(false);
    expect(answered.media.map((medium) => [medium.mediaType, [...medium.bytes]])).toEqual([['image/png', [0, 0, 0]]]);
    expect(JSON.stringify([answered.value, answered.text])).not.toContain('AAAA');
    expect(JSON.stringify(answered)).not.toContain('BBBB');
    expect(mcpAnswer({ content: [] }).failed).toBe(false);
  });
});

describe('mcpToolCatalog', () => {
  test('classifies mutation and deny subjects before calling the pool', () => {
    const catalog = mcpToolCatalog({
      projectId: 5,
      declaration,
      descriptors: [
        { name: 'echo', inputSchema: { type: 'object' } },
        { name: 'grow', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
      ],
      pool,
    }).tools;
    expect(catalog.echo?.mutates ?? false).toBe(false);
    expect(catalog.grow?.mutates).toBe(true);
    expect(catalog.grow?.confirmation?.intent).toBe('destructive');
    const echo = Tool.toolSubjects(catalog.echo!, {}, caller);
    const grow = Tool.toolSubjects(catalog.grow!, {}, caller);
    expect(echo.map((subject) => subject.value)).toContain('mcp:files/echo');
    expect(grow.map((subject) => subject.value)).toContain('mcp:files/grow');
    expect(echo.map((subject) => subject.kind)).toEqual(['network', 'network']);
    expect(grow.map((subject) => subject.kind)).toEqual(['write', 'write']);
  });
  test('two servers publishing one name keep their own subjects', () => {
    const descriptors = [{ name: 'search', inputSchema: { type: 'object' } }];
    const first = mcpToolCatalog({ projectId: 5, declaration: { ...declaration, name: 'a' }, descriptors, pool }).tools;
    const second = mcpToolCatalog({ projectId: 5, declaration: { ...declaration, name: 'b' }, descriptors, pool }).tools;
    expect(Object.keys(first)).toEqual(['search']);
    expect(Object.keys(second)).toEqual(['search']);
    const a = Tool.toolSubjects(first.search!, {}, caller).map((subject) => subject.value);
    const b = Tool.toolSubjects(second.search!, {}, caller).map((subject) => subject.value);
    expect(a).toContain('mcp:a/search');
    expect(b).toContain('mcp:b/search');
    const identity = (values: readonly string[]) => values.find((value) => value.startsWith('mcp-server:'));
    expect(identity(a)).toBeDefined();
    expect(identity(a)).not.toBe(identity(b));
  });
  test('keeps descriptors named after prototype members as own entries', () => {
    const built = mcpToolCatalog({
      projectId: 5,
      declaration,
      descriptors: [
        { name: '__proto__', inputSchema: { type: 'object' } },
        { name: 'constructor', inputSchema: { type: 'object' } },
      ],
      pool,
    });
    expect(Object.keys(built.tools).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.hasOwn(built.tools, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(built.tools)).toBeNull();
    expect(built.excluded).toEqual([]);
  });
  test('names descriptors that it cannot offer and why', () => {
    const built = mcpToolCatalog({
      projectId: 5,
      declaration,
      descriptors: [
        { name: 'echo', inputSchema: { type: 'object' } },
        { name: 'slow_job', inputSchema: { type: 'object' }, execution: { taskSupport: 'required' } },
        { name: 'optional_job', inputSchema: { type: 'object' }, execution: { taskSupport: 'optional' } },
        { name: 'read/private', inputSchema: { type: 'object' } },
        { name: 'x'.repeat(80), inputSchema: { type: 'object' } },
      ],
      pool,
    });
    expect(Object.keys(built.tools).sort()).toEqual(['echo', 'optional_job']);
    expect(built.excluded.map((one) => one.tool).sort()).toEqual(['read/private', 'slow_job', 'x'.repeat(80)]);
    expect(built.excluded.every((one) => one.reason.length > 0)).toBe(true);
  });
  it.effect('turns a transport failure into a tool refusal naming the server', () =>
    Effect.gen(function* () {
      const catalog = mcpToolCatalog({ projectId: 5, declaration, descriptors: [{ name: 'echo', inputSchema: { type: 'object' } }], pool });
      const execute = Tool.toolExecute(catalog.tools.echo!);
      if (execute === null) return yield* Effect.die('the echo tool has no body');
      const refused = yield* Effect.result(execute({}, { toolCallId: 'call-1', caller, messages: [] }));
      expect(refused._tag === 'Failure' && refused.failure._tag).toBe('Tool.Failed');
      expect(refused._tag === 'Failure' && refused.failure.reason).toContain('files');
    }),
  );
});

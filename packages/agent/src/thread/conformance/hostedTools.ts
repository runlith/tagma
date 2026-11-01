import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Schema, type Scope } from 'effect';
import { agentDeferredTools } from '../../agent/AgentDeferredTools';
import { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { compositionEntryId } from '../../transcript/entryNames';
import { coreEntry } from '../../transcript/kinds';
import { hosted } from './hostedWorld';
import type { ThreadStorageFactory } from './storagePort';
export function describeHostedTools<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: hosted tools keep the native input contract`, () => {
    test(
      'a turn-fixed catalog advertises admitted schemas while the step policy still judges calls',
      Effect.fnUntraced(function* () {
        const catalog: ToolCatalog = {
          act: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Act after revelation.',
            parameters: Schema.Struct({}),
            exposure: 'deferred',
            execute: () => Effect.succeed('acted'),
          }),
        };
        const run = yield* hosted(open, { ...catalog, ...agentDeferredTools(catalog) });
        yield* run.storage.aggregate.update(run.thread.id, { capabilities: { ...run.thread.capabilities, toolCatalog: 'turn' } });
        const hosting = run.world.harness.runs.hosting();
        yield* hosting.open(run.thread.id, run.thread.agentId);
        expect((yield* hosting.tools(run.thread.id, run.thread.agentId)).tools.map((tool) => tool.name)).toContain('act');
        expect((yield* run.call('locked', 'act')).failed).toBe(true);
        yield* run.call('reveal', 'tool_search', { query: 'select:act' });
        expect(yield* run.call('unlocked', 'act')).toMatchObject({ failed: false, output: { type: 'text', value: 'acted' } });
      }),
    );
    test(
      'a dispatching catalog lists its direct tools and the dispatcher whatever a search reveals, composes the request from that list, and the search hands over the revealed definition',
      Effect.fnUntraced(function* () {
        const catalog: ToolCatalog = {
          read: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Read directly.',
            parameters: Schema.Struct({}),
            execute: () => Effect.succeed('read'),
          }),
          send: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Send to the named recipient.',
            parameters: Schema.Struct({ to: Schema.String }),
            exposure: 'deferred',
            execute: (input) => Effect.succeed(input),
          }),
        };
        const run = yield* hosted(open, { ...catalog, ...agentDeferredTools(catalog) });
        yield* run.storage.aggregate.update(run.thread.id, { capabilities: { ...run.thread.capabilities, toolCatalog: 'dispatch' } });
        const hosting = run.world.harness.runs.hosting();
        yield* hosting.open(run.thread.id, run.thread.agentId);
        const listed = Effect.map(hosting.tools(run.thread.id, run.thread.agentId), (offered) => ({
          tools: offered.tools.map((tool) => tool.name),
          dispatch: offered.dispatch,
        }));
        const before = yield* listed;
        expect(yield* run.call('locked', 'send', { to: 'lead' })).toMatchObject({
          failed: true,
          output: { value: expect.stringContaining('reveal it first') },
        });
        expect(yield* run.call('reveal', 'tool_search', { query: 'select:send' })).toMatchObject({
          failed: false,
          output: { type: 'json', value: { tools: [{ name: 'send', inputSchema: catalog.send!.inputSchema }] } },
        });
        expect([before, yield* listed]).toEqual([
          { tools: ['read', 'tool_search', 'call_tool'], dispatch: true },
          { tools: ['read', 'tool_search', 'call_tool'], dispatch: true },
        ]);
        const composed = yield* run.storage.aggregate.entryById(run.thread.id, compositionEntryId(run.run.id));
        const composition = composed !== undefined && coreEntry(composed) && composed.type === 'composition' ? composed : null;
        expect(composition?.tools.each.map((tool) => [tool.name, tool.hidden])).toEqual([
          ['read', undefined],
          ['tool_search', undefined],
          ['call_tool', undefined],
        ]);
        expect(yield* run.call('sent', 'send', { to: 'lead' })).toMatchObject({
          failed: false,
          output: { type: 'json', value: { to: 'lead' } },
        });
      }),
    );
    test(
      'an unrevealed tool refuses invalid input with its schema, then reads a JSON list after revelation',
      Effect.fnUntraced(function* () {
        const input = { to: ['lead', 'worker'] };
        const catalog: ToolCatalog = {
          send: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Send to the named recipients.',
            parameters: Schema.Struct({ to: Schema.Array(Schema.String) }),
            exposure: 'deferred',
            execute: (input) => Effect.succeed(input),
          }),
        };
        const run = yield* hosted(open, { ...catalog, ...agentDeferredTools(catalog) });
        yield* run.world.harness.runs.hosting().open(run.thread.id, run.thread.agentId);
        const invalid = yield* run.call('invalid', 'send', { to: [42] });
        expect(invalid.failed).toBe(true);
        const schema = JSON.stringify(catalog.send!.inputSchema).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        expect(invalid.output).toMatchObject({
          type: 'text',
          value: expect.stringMatching(new RegExp(`^refused\\[body-shape\\]: .*to\\[0\\] expects a string[^]*\\nschema: ${schema}$`, 'u')),
        });
        yield* run.call('reveal', 'tool_search', { query: 'select:send' });
        expect(yield* run.call('send', 'send', { to: JSON.stringify(input.to) })).toMatchObject({
          failed: false,
          output: { type: 'json', value: input },
        });
      }),
    );
  });
}

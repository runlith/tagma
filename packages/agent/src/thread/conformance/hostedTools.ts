import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Schema, type Scope } from 'effect';
import { agentDeferredTools } from '../../agent/AgentDeferredTools';
import { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { hosted } from './hostedCalls';
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

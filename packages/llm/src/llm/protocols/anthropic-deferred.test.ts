import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { LLMRequest, Message, ToolChoice, ToolDefinition } from '../schema/messages';
import { Model } from '../schema/options';
import * as AnthropicMessages from './anthropic-messages';
import { prepare } from '../route/client';

const request = (references: readonly string[]) =>
  new LLMRequest({
    model: Model.make({ id: 'claude-test', provider: 'anthropic', route: AnthropicMessages.route }),
    system: [],
    tools: [
      ToolDefinition.make({ name: 'find_tools', description: 'Find tools.', inputSchema: { type: 'object' } }),
      ToolDefinition.make({ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' }, deferred: true }),
    ],
    messages: [
      Message.user('Read the file.'),
      Message.assistant({ type: 'tool-call', id: 'search-1', name: 'find_tools', input: {} }),
      Message.tool({ id: 'search-1', name: 'find_tools', result: 'Found one tool.', resultType: 'text', toolReferences: references }),
    ],
  });
it.effect('client search references resolve against deferred definitions through the Anthropic request boundary', () =>
  Effect.gen(function* () {
    const call = request(['read_file']);
    const prepared = yield* prepare<AnthropicMessages.AnthropicMessagesBody>(call);
    expect(prepared.body.tools?.find((tool) => tool.name === 'read_file')).toMatchObject({ defer_loading: true });
    expect(prepared.body.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'search-1',
          content: [
            { type: 'tool_reference', tool_name: 'read_file' },
            { type: 'text', text: 'Found one tool.' },
          ],
        },
      ],
    });
    expect(call.messages.at(-1)?.content[0]).toMatchObject({ result: { value: 'Found one tool.' } });
    const transport = yield* AnthropicMessages.route.prepareTransport(prepared.body, call);
    expect(transport.request.headers['anthropic-beta']).toBe('advanced-tool-use-2025-11-20');
  }),
);

it.effect('a reference the request does not declare deferred is left unspelled beside the ones it does', () =>
  Effect.gen(function* () {
    for (const name of ['missing_tool', 'find_tools']) {
      const prepared = yield* prepare<AnthropicMessages.AnthropicMessagesBody>(request([name]));
      expect(prepared.body.messages.at(-1)).toMatchObject({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'search-1', content: 'Found one tool.' }],
      });
    }
    const mixed = yield* prepare<AnthropicMessages.AnthropicMessagesBody>(request(['missing_tool', 'read_file']));
    expect(mixed.body.messages.at(-1)).toMatchObject({
      content: [
        {
          type: 'tool_result',
          content: [
            { type: 'tool_reference', tool_name: 'read_file' },
            { type: 'text', text: 'Found one tool.' },
          ],
        },
      ],
    });
  }),
);

it.effect('references under tool choice none are left unspelled', () =>
  Effect.gen(function* () {
    const call = LLMRequest.update(request(['read_file']), { toolChoice: ToolChoice.make('none') });
    const prepared = yield* prepare<AnthropicMessages.AnthropicMessagesBody>(call);
    expect(prepared.body.messages.at(-1)).toMatchObject({ content: [{ type: 'tool_result', content: 'Found one tool.' }] });
  }),
);

it.effect('revealing a deferred definition preserves the Anthropic cache prefix', () =>
  Effect.gen(function* () {
    const after = request(['read_file']);
    const before = LLMRequest.update(after, {
      tools: after.tools.filter((tool) => !tool.deferred),
      messages: [Message.user('Read the file.')],
    });
    const opening = yield* AnthropicMessages.protocol.body.from(before);
    const continued = yield* AnthropicMessages.protocol.body.from(after);
    expect(AnthropicMessages.protocol.body.cachePrefix?.(continued)).toEqual(AnthropicMessages.protocol.body.cachePrefix?.(opening));
  }),
);

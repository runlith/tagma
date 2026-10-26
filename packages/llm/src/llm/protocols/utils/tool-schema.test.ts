import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { LLMRequest, ToolDefinition } from '../../schema/messages';
import { Model } from '../../schema/options';
import * as Chat from '../openai-chat';
import * as Responses from '../openai-responses';
import type { JsonSchema } from '../../schema/ids';
import { ToolSchemaProjection } from './tool-schema';

it.effect('OpenAI request bodies preserve required nullable inputs, including nested lists and objects', () =>
  Effect.gen(function* () {
    const nullable = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
    const inputSchema = {
      type: 'object',
      properties: {
        base: nullable,
        entries: { type: 'array', items: { type: 'object', properties: { value: nullable }, required: ['value'] } },
      },
      required: ['base', 'entries'],
      additionalProperties: false,
    } as const satisfies JsonSchema;
    const tool = ToolDefinition.make({ name: 'enforce', description: 'Set a rule.', inputSchema });
    const request = (route: typeof Chat.route | typeof Responses.route) =>
      new LLMRequest({
        model: Model.make({ id: 'test', provider: 'test-provider', route }),
        system: [],
        messages: [],
        tools: [tool],
      });
    const chat = yield* Chat.protocol.body.from(request(Chat.route));
    expect(chat.tools?.[0]?.function.parameters).toEqual(inputSchema);
    const responses = yield* Responses.protocol.body.from(request(Responses.route));
    expect(responses.tools?.[0]).toMatchObject({ type: 'function', parameters: inputSchema });
  }),
);

describe('flat root object tool schemas', () => {
  test('flattens only the object root and retains finite fields, property unions and tagged guidance', () => {
    const position = { anyOf: [{ type: 'integer' }, { type: 'string' }] } as const;
    const inputSchema = {
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: {
            type: { const: 'captures' },
            limit: {
              anyOf: [
                { type: 'number', exclusiveMinimum: 0 },
                { type: 'string', enum: ['Infinity', '-Infinity', 'NaN'] },
              ],
            },
            at: position,
          },
          required: ['type', 'limit', 'at'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { type: { const: 'profile' }, id: { type: 'string' }, at: position },
          required: ['type', 'id', 'at'],
          additionalProperties: false,
        },
      ],
    } as const satisfies JsonSchema;

    const projected = ToolSchemaProjection.flatRootObject(inputSchema);
    const properties = projected.properties as Record<string, Record<string, unknown>>;

    expect(projected.type).toBe('object');
    expect('anyOf' in projected).toBe(false);
    expect(projected.required).toEqual(['type', 'at']);
    expect(properties['type']?.enum).toEqual(['captures', 'profile']);
    expect(typeof properties['type']?.description).toBe('string');
    expect(properties['limit']?.type).toBe('number');
    expect(typeof properties['limit']?.description).toBe('string');
    expect(typeof properties['id']?.description).toBe('string');
    expect(properties['at']?.anyOf).toEqual(position.anyOf);
    expect(inputSchema.anyOf).toHaveLength(2);
  });
});

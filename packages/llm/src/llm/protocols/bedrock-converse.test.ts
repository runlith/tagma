import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as Auth from '../route/auth';
import { LLMRequest, Message, ToolResultPart } from '../schema/messages';
import { protocol, route } from './bedrock-converse';

it.effect('ids another provider minted reach Converse in its id alphabet and length, still paired and distinct', () =>
  Effect.gen(function* () {
    const long = `call_${'a'.repeat(70)}`;
    const ids = ['call_3dd02836#24d06945', 'call_3dd02836$24d06945', long, 'functions.read:0', 'tooluse_Native'];
    const request = new LLMRequest({
      model: route
        .with({ endpoint: { baseURL: 'https://bedrock-runtime.test' }, auth: Auth.none })
        .model({ id: 'anthropic.claude-sonnet-4-5-v1:0', provider: 'test-provider' }),
      system: [],
      tools: [],
      messages: [
        Message.user('Continue.'),
        Message.make({ role: 'assistant', content: ids.map((id) => ({ type: 'tool-call' as const, id, name: 'read', input: {} })) }),
        Message.make({ role: 'tool', content: ids.map((id) => ToolResultPart.from({ id, name: 'read', result: id, resultType: 'text' })) }),
      ],
    });

    const body = yield* protocol.body.from(request);
    const calls = body.messages[1]!.content.map((block) => ('toolUse' in block ? block.toolUse.toolUseId : ''));
    const results = body.messages[2]!.content.map((block) => ('toolResult' in block ? block.toolResult.toolUseId : ''));

    for (const id of calls) {
      expect(id).toMatch(/^[a-zA-Z0-9_.:-]+$/);
      expect(id.length).toBeLessThanOrEqual(64);
    }
    expect(new Set(calls).size).toBe(ids.length);
    expect(results).toEqual(calls);
    expect(calls.slice(3)).toEqual(['functions.read:0', 'tooluse_Native']);
  }),
);

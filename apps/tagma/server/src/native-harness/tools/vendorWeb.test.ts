import { openModelClient } from '@runlith/llm/models/client';
import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { modelRequester, wireToolDefinitions } from '@runlith/agent/ModelRequests';
import { toolArguments } from '@runlith/agent/tool/arguments';
import { openaiSubscriptionRegistration } from '@runlith/adapter-openai/profiles/openai';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { answering } from '@runlith/llm/route/transport/answering';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { judge } from '@runlith/agent/modes/ApprovalMode';
import { type Tool, toolExecute, toolPartialDisplay, toolPrepare } from '@runlith/agent/tool';
import { readPartialJsonState } from '@runlith/utils/json';
import type { Egress } from '@runlith/agent-tools/world';
import { type ServedWeb, WebRefused } from '@runlith/llm/profiles/vendorWeb';
import { createWebfetchTool } from '@runlith/agent-tools/webfetch';
import { createWebsearchTool } from '@runlith/agent-tools/websearch';
import { Effect, Schema } from 'effect';
import { vendorWebTools } from './vendorWeb.js';

const egress: Egress = {
  fetch: (async () => new Response('<h1>x</h1>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch,
  fetchDefaultMs: 1000,
  fetchCeilingMs: 2000,
  searchMs: 1000,
};

const SCHEMA = { type: 'object', properties: { search_query: { type: 'array' }, open: { type: 'array' } } };
const MEMORY = () => ({ page: () => undefined, keep: () => undefined, allowed: () => false, allow: () => undefined });
const TAGMA = { websearch: createWebsearchTool({ egress }), webfetch: createWebfetchTool({ egress }) };

type Commands = { readonly search_query?: readonly { q: string }[]; readonly open?: readonly { ref_id: string }[] };

const web = (outcome: 'answers' | 'refuses'): ServedWeb => ({
  tools: {
    websearch: {
      input: Schema.Unknown,
      wire: {
        vendor: { name: 'run', namespace: { name: 'web', description: 'The web.' } },
        description: 'The provider words.',
        inputSchema: SCHEMA,
      },
      reads: (input) => (input as Commands).open !== undefined,
      targets: (input) => ({
        queries: ((input as Commands).search_query ?? []).map((query) => query.q),
        pages: ((input as Commands).open ?? []).map((page) => page.ref_id),
      }),
      run: (input) =>
        outcome === 'answers'
          ? Effect.succeed(`found ${JSON.stringify(input)}`)
          : Effect.fail(new WebRefused({ reason: 'search is busy' })),
    },
  },
});

const subscription = openaiSubscriptionRegistration({ mcpServer: 'test', client: { name: 'test', version: '1' } });
const credentials: ModelCredentials = {
  apiKey: async () => 'key',
  accessToken: async () => 'token',
  credential: async () => ({ accessToken: 'token', refreshToken: 'refresh', expiresAt: 0, accountId: 'account' }),
};

const codexWeb = Effect.fnUntraced(function* () {
  const door = answering(() => new Response('no request leaves this test', { status: 599 }));
  const opened = modelRequester(modelCatalog([subscription]), credentials, yield* openModelClient(door)).request({
    ownerId: 'owner',
    provider: subscription.id,
    model: 'gpt-5.6-sol',
  }).web;
  if (opened === undefined) return yield* Effect.die(new Error('gpt-5.6-sol offers no web of its own.'));
  return yield* opened;
});

const caller = { agentId: 'a', ownerId: 'o', thread: null };
const call = { toolCallId: 'call-1', caller, messages: [] };
const modes = builtinModeRegistry();

const asks = (tool: Tool, input: unknown, mode: string) =>
  Effect.map(
    toolPrepare(tool)!(input, { toolCallId: 'call-1', caller }),
    (prepared) => judge(tool.approval, prepared.raised ?? [], modes.find(mode)!, modes, { toolName: 'websearch', mutating: false }).verdict,
  );

describe('the provider web as native tools', () => {
  test('stands only in the places of the Tagma tools the provider declares, carrying its own wire beside the Tagma name', () => {
    const tools = vendorWebTools({ web: web('answers'), memory: MEMORY }, egress, TAGMA);
    expect(Object.keys(tools)).toEqual(['websearch']);
    expect(wireToolDefinitions(tools, undefined).map(({ name, description, vendorWire }) => ({ name, description, vendorWire }))).toEqual([
      {
        name: 'websearch',
        description: 'The provider words.',
        vendorWire: { name: 'run', namespace: { name: 'web', description: 'The web.' } },
      },
    ]);
  });

  it.live(
    'web.run of the OpenAI subscription never asks to search, asks in review to read pages or to run a command it does not know, and trust asks neither',
    () =>
      Effect.gen(function* () {
        const search = vendorWebTools({ web: yield* codexWeb(), memory: MEMORY }, egress, TAGMA)['websearch']!;
        const searching = { search_query: [{ q: 'bun' }] };
        const reading = { search_query: [{ q: 'bun' }], open: [{ ref_id: 'https://bun.sh' }] };
        const unknown = { browse: [{ url: 'https://bun.sh' }] };
        expect(yield* asks(search, searching, 'review')).toBe('allow');
        expect(yield* asks(search, reading, 'review')).toBe('ask');
        expect(yield* asks(search, unknown, 'review')).toBe('ask');
        expect(yield* asks(search, searching, 'trust')).toBe('allow');
        expect(yield* asks(search, reading, 'trust')).toBe('allow');
      }),
  );

  it.live('the subjects of a web.run call are its queries and its pages as the Tagma tools name them', () =>
    Effect.gen(function* () {
      const search = vendorWebTools({ web: yield* codexWeb(), memory: MEMORY }, egress, TAGMA)['websearch']!;
      const prepared = yield* toolPrepare(search)!(
        { search_query: [{ q: 'bun' }], open: [{ ref_id: 'https://bun.sh' }, { ref_id: 'turn0search0' }] },
        { toolCallId: 'call-1', caller },
      );
      expect([...new Set(prepared.subjects.map((subject) => subject.value))]).toEqual(['bun', 'https://bun.sh']);
    }),
  );

  it.live('an input the recorded web.run schema does not accept is refused as the arguments of the call', () =>
    Effect.gen(function* () {
      const search = vendorWebTools({ web: yield* codexWeb(), memory: MEMORY }, egress, TAGMA)['websearch']!;
      expect((yield* Effect.result(toolArguments(search, 'websearch', { search_query: [{ q: 'bun' }] })))._tag).toBe('Success');
      expect((yield* Effect.result(toolArguments(search, 'websearch', { search_query: 'bun' })))._tag).toBe('Failure');
    }),
  );

  test('a streaming call names its first query once that field has closed, before the provider answers', () => {
    const search = vendorWebTools({ web: web('answers'), memory: MEMORY }, egress, TAGMA)['websearch']!;
    const state = readPartialJsonState('{"search_query":[{"q":"bun pricing"}],"open":[{"ref_');
    expect(state && toolPartialDisplay(search, state)?.title).toBe('bun pricing');
  });

  it.effect('a refusal of the provider is a failed call that carries its words', () =>
    Effect.gen(function* () {
      const search = toolExecute(vendorWebTools({ web: web('refuses'), memory: MEMORY }, egress, TAGMA)['websearch']!)!;
      const failure = yield* Effect.flip(search({ search_query: [{ q: 'bun' }] }, call));
      expect(failure.message).toBe('search is busy');
    }),
  );

  it.effect('an answer of the provider is the text of the call', () =>
    Effect.gen(function* () {
      const search = toolExecute(vendorWebTools({ web: web('answers'), memory: MEMORY }, egress, TAGMA)['websearch']!)!;
      const answer = yield* search({ search_query: [{ q: 'bun' }] }, call);
      expect(answer).toMatchObject({ value: 'found {"search_query":[{"q":"bun"}]}' });
    }),
  );
});

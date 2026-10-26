import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { answering, type Sent } from '@runlith/llm/route/transport/answering';
import { doorExecutorLayer } from '@runlith/llm/route/executor';
import type { ModelCredentials, ProductIdentity, ProfileCall } from '@runlith/llm/profiles/contract';
import type { VendorWeb } from '@runlith/llm/profiles/vendorWeb';
import { Message } from '@runlith/llm/schema/messages';
import { openaiConsoleRegistration, openaiSubscriptionRegistration } from './openai';
import { CODEX_WEB } from './codexWeb.generated';

const product: ProductIdentity = { mcpServer: 'test-client', client: { name: 'test-client', version: '3.2.1' } };
const subscription = openaiSubscriptionRegistration(product);

const credentialsWith = (token: () => string, recover?: () => string): ModelCredentials => ({
  apiKey: async () => 'sk-test',
  accessToken: async () => token(),
  recoverAccessToken: recover === undefined ? undefined : async () => recover(),
  credential: async () => ({ accessToken: token(), refreshToken: 'refresh', expiresAt: 0, accountId: 'account-1' }),
});

const call = (model: string): ProfileCall => ({
  model,
  rung: null,
  adaptive: false,
  reasoningOutput: false,
  outputTokens: 1,
  switches: {},
});

const webOf = (model: string, credentials: ModelCredentials = credentialsWith(() => 'token')) =>
  subscription.profile.web?.({ ownerId: 'owner', model, credentials, cacheGroup: 'group' }, call(model));

const searchOf = Effect.fnUntraced(function* (credentials?: ModelCredentials) {
  const opened = webOf('gpt-5.6-sol', credentials);
  if (opened === undefined) return yield* Effect.die('gpt-5.6-sol offers no web of its own.');
  const web: VendorWeb = yield* opened;
  const search = web.lifetimes === undefined ? web.tools.websearch : undefined;
  if (search === undefined) return yield* Effect.die('The subscription web declares no search.');
  return search;
});

const searched = Effect.fn('codexWeb.testSearch')(function* (
  input: unknown,
  respond: (sent: Sent) => Response,
  messages: readonly Message[] = [],
  credentials?: ModelCredentials,
) {
  const search = yield* searchOf(credentials);
  return yield* Effect.result(search.run(input, { messages, measure: (_, work) => Effect.map(work, (read) => read.value) })).pipe(
    Effect.provide(doorExecutorLayer(answering(respond))),
  );
});

const answer = (output: string) => new Response(JSON.stringify({ output, encrypted_output: 'x', results: [] }), { status: 200 });

describe('the web the OpenAI subscription brings', () => {
  it.effect('is offered to a model the recorded form names, as web.run in the place of websearch alone, and to no other road', () =>
    Effect.gen(function* () {
      const opened = webOf('gpt-5.6-sol');
      expect(opened).toBeDefined();
      const web = yield* opened!;
      expect(Object.keys(web.tools)).toEqual(['websearch']);
      expect(web.tools.websearch?.wire.vendor).toEqual({
        name: 'run',
        namespace: { name: 'web', description: 'Tools in the web namespace.' },
      });
      expect(webOf('gpt-5.5')).toBeUndefined();
      expect(openaiConsoleRegistration.profile.web).toBeUndefined();
    }),
  );

  it.effect('reads pages for any command but searches and lookups, and for a key its form does not name', () =>
    Effect.gen(function* () {
      const search = yield* searchOf();
      expect(search.reads({ search_query: [{ q: 'bun' }], response_length: 'short' })).toBe(false);
      expect(search.reads({ weather: [{ location: 'Paris' }] })).toBe(false);
      expect(search.reads({ search_query: [{ q: 'bun' }], open: [{ ref_id: 'https://bun.sh' }] })).toBe(true);
      expect(search.reads({ find: [{ ref_id: 'turn0fetch1', pattern: 'x' }] })).toBe(true);
      expect(search.reads({ browse: [{ url: 'https://bun.sh' }] })).toBe(true);
      expect(search.targets({ search_query: [{ q: 'bun' }], open: [{ ref_id: 'https://bun.sh' }, { ref_id: 'turn0search0' }] })).toEqual({
        queries: ['bun'],
        pages: ['https://bun.sh'],
      });
    }),
  );

  it.effect(
    'the conversation tail keeps the visible words alone, cuts a long answer in its middle, and is left out when nobody spoke',
    () =>
      Effect.gen(function* () {
        const bodies: unknown[] = [];
        const keep = (request: Sent) => {
          bodies.push(JSON.parse(request.text));
          return answer('found');
        };
        const long = `${'a'.repeat(3_000)}${'b'.repeat(3_000)}`;
        yield* searched({ search_query: [{ q: 'bun' }] }, keep, [
          Message.user('the question'),
          Message.system('a note Tagma slipped in'),
          Message.assistant(long),
          Message.assistant('more words past the budget'),
          Message.user('the follow-up'),
        ]);
        yield* searched({ search_query: [{ q: 'bun' }] }, keep, [Message.system('only Tagma spoke')]);
        const [tail, silent] = bodies as { input?: { role: string; content: { text: string }[] }[] }[];
        expect(tail?.input?.map((item) => item.role)).toEqual(['user', 'assistant', 'user']);
        const cut = tail?.input?.[1]?.content[0]?.text ?? '';
        expect(cut.startsWith('a'.repeat(2_000))).toBe(true);
        expect(cut.endsWith('b'.repeat(2_000))).toBe(true);
        expect(cut).toContain('…500 tokens truncated…');
        expect(silent !== undefined && 'input' in silent).toBe(false);
      }),
  );

  it.effect('posts the commands with the conversation tail to the search endpoint and answers its output', () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];
      const messages = [
        Message.user('the old question'),
        Message.assistant('an old answer'),
        Message.user('the previous question'),
        Message.assistant('the previous answer'),
        Message.user('the current question'),
        Message.assistant('working on it'),
      ];
      const result = yield* searched(
        { search_query: [{ q: 'bun' }] },
        (request) => {
          sent.push(request);
          return answer('Bun 2.0 (https://bun.sh)');
        },
        messages,
      );
      expect(result).toMatchObject({ _tag: 'Success', success: 'Bun 2.0 (https://bun.sh)' });
      expect(sent.map((request) => request.url)).toEqual(['https://chatgpt.com/backend-api/codex/alpha/search']);
      expect(sent[0]?.headers['authorization']).toBe('Bearer token');
      expect(sent[0]?.headers['chatgpt-account-id']).toBe('account-1');
      const body = JSON.parse(sent[0]!.text);
      expect(body).toMatchObject({
        model: 'gpt-5.6-sol',
        commands: { search_query: [{ q: 'bun' }] },
        settings: CODEX_WEB.settings,
        max_output_tokens: CODEX_WEB.maxOutputTokens,
      });
      expect(body.input).toEqual([
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'the previous question' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'the previous answer' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'the current question' }] },
      ]);
    }),
  );

  it.effect('a refusal of the endpoint is a failure carrying its words, and an empty output is refused', () =>
    Effect.gen(function* () {
      const refused = yield* searched(
        { search_query: [{ q: 'bun' }] },
        () => new Response('{"error":{"message":"search is not available on this plan"}}', { status: 403 }),
      );
      expect(refused._tag === 'Failure' && refused.failure.message).toContain('search is not available on this plan');
      const empty = yield* searched({ search_query: [{ q: 'bun' }] }, () => answer(''));
      expect(empty._tag === 'Failure' && empty.failure._tag).toBe('WebRefused');
    }),
  );

  it.effect('a rejected bearer is recovered once and the search is sent again', () =>
    Effect.gen(function* () {
      let token = 'old';
      const credentials = credentialsWith(
        () => token,
        () => {
          token = 'fresh';
          return token;
        },
      );
      const bearers: string[] = [];
      const result = yield* searched(
        { search_query: [{ q: 'bun' }] },
        (request) => {
          bearers.push(request.headers['authorization'] ?? '');
          return request.headers['authorization'] === 'Bearer old'
            ? new Response('{"error":{"message":"Rejected"}}', { status: 401 })
            : answer('found');
        },
        [],
        credentials,
      );
      expect(result).toMatchObject({ _tag: 'Success', success: 'found' });
      expect(bearers).toEqual(['Bearer old', 'Bearer fresh']);
    }),
  );

  it.effect('a refused renewal ends the search without sending the rejected bearer again', () =>
    Effect.gen(function* () {
      const credentials = credentialsWith(
        () => 'old',
        () => {
          throw new Error('renewal refused');
        },
      );
      const bearers: string[] = [];
      const result = yield* searched(
        { search_query: [{ q: 'bun' }] },
        (request) => {
          bearers.push(request.headers['authorization'] ?? '');
          return new Response('{"error":{"message":"Rejected"}}', { status: 401 });
        },
        [],
        credentials,
      );
      expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'LLM.Error' } });
      expect(bearers).toEqual(['Bearer old']);
    }),
  );
});

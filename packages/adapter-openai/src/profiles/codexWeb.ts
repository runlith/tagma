import { Effect, Schedule, Schema } from 'effect';
import type { HttpClientResponse } from 'effect/http';
import * as ProviderShared from '@runlith/llm/protocols/shared';
import * as Auth from '@runlith/llm/route/auth';
import { HttpExecutor } from '@runlith/llm/route/executor';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { JsonSchema } from '@runlith/llm/schema/ids';
import { namedHeaders } from '@runlith/llm/utils/headers';
import { isRecord } from '@runlith/llm/utils/record';
import { type VendorWeb, type VendorWebCall, WebRefused, type WebTargets, type WebTool } from '@runlith/llm/profiles/vendorWeb';
import { conversationTail } from './codexWebTail';

export type CodexWebForm = {
  readonly client: string;
  readonly models: readonly string[];
  readonly path: string;
  readonly namespace: { readonly name: string; readonly description: string };
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
};

export type SearchRoute = {
  readonly url: string;
  readonly auth: Auth.Auth;
  readonly recover: Effect.Effect<void, LLMError> | undefined;
  readonly session: Effect.Effect<string>;
  readonly model: string;
};

const SEARCHES = new Set(['search_query', 'image_query', 'finance', 'weather', 'sports', 'time', 'response_length']);
const QUERIES = ['search_query', 'image_query'];
const PAGES = ['open', 'click', 'find', 'screenshot'];

const SearchAnswer = Schema.Struct({ output: Schema.String });
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(SearchAnswer));

export const webReads = (input: unknown): boolean => !isRecord(input) || Object.keys(input).some((key) => !SEARCHES.has(key));

const entries = (input: unknown, keys: readonly string[], field: string): readonly string[] =>
  isRecord(input)
    ? keys.flatMap((key) => {
        const list = input[key];
        return Array.isArray(list)
          ? list.flatMap((entry) => (isRecord(entry) && typeof entry[field] === 'string' ? [entry[field]] : []))
          : [];
      })
    : [];

const addressed = (ref: string): boolean => URL.canParse(ref) && /^https?:$/.test(new URL(ref).protocol);

export const webTargets = (input: unknown): WebTargets => ({
  queries: entries(input, QUERIES, 'q'),
  pages: [...new Set(entries(input, PAGES, 'ref_id').filter(addressed))],
});

const kind = (value: unknown): string =>
  Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;

const conforms = (schema: unknown, value: unknown, at: string): string | undefined => {
  if (!isRecord(schema)) return undefined;
  const expected = schema['type'];
  const actual = kind(value);
  if (typeof expected === 'string' && expected !== actual && !(expected === 'number' && actual === 'integer'))
    return `${at} must be ${expected}, not ${actual}`;
  if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) return `${at} must be one of ${schema['enum'].join(', ')}`;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = conforms(schema['items'], item, `${at}[${index}]`);
      if (issue !== undefined) return issue;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const required = Array.isArray(schema['required']) ? schema['required'] : [];
  const missing = required.find((key) => typeof key === 'string' && !(key in value));
  if (missing !== undefined) return `${at}.${missing} is required`;
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  for (const [key, held] of Object.entries(value)) {
    const issue = conforms(properties[key], held, `${at}.${key}`);
    if (issue !== undefined) return issue;
  }
  return undefined;
};

const inputOf = (form: CodexWebForm) =>
  Schema.Record(Schema.String, Schema.Unknown).check(Schema.makeFilter((input) => conforms(form.parameters, input, 'input') ?? true));

const answered = (answer: HttpClientResponse.HttpClientResponse): Effect.Effect<string, WebRefused> =>
  answer.text.pipe(
    Effect.flatMap(decodeAnswer),
    Effect.mapError((failure) => new WebRefused({ reason: `The search answer could not be read: ${failure.message}` })),
    Effect.flatMap(({ output }) =>
      output.trim() === '' ? Effect.fail(new WebRefused({ reason: 'The search answered with no output.' })) : Effect.succeed(output),
    ),
  );

const searched = Effect.fn('codexWeb.search')(function* (form: CodexWebForm, route: SearchRoute, input: unknown, call: VendorWebCall) {
  const executor = yield* HttpExecutor;
  const tail = conversationTail(call.messages);
  const body = JSON.stringify({
    id: yield* route.session,
    model: route.model,
    input: tail.length === 0 ? undefined : tail,
    commands: input,
    settings: form.settings,
    max_output_tokens: form.maxOutputTokens,
  });
  const once = Effect.gen(function* () {
    const headers = yield* Auth.toEffect(route.auth)({
      method: 'POST',
      url: route.url,
      body,
      headers: namedHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    });
    return yield* Effect.scopedWith((lifetime) =>
      Effect.flatMap(executor.execute(ProviderShared.jsonPost({ url: route.url, body, headers }), lifetime), answered),
    );
  });
  const recovery = Schedule.recurs(1).pipe(
    Schedule.while(({ input }: Schedule.Metadata<number, LLMError | WebRefused>) =>
      Effect.succeed(input._tag === 'LLM.Error' && input.status === 401 && route.recover !== undefined),
    ),
    Schedule.tap(() => route.recover ?? Effect.void),
  );
  return yield* Effect.retry(once, recovery);
});

export const codexWeb = (form: CodexWebForm): ((route: SearchRoute) => VendorWeb) => {
  const wire = { vendor: { name: form.name, namespace: form.namespace }, description: form.description, inputSchema: form.parameters };
  const input = inputOf(form);
  return (route) => {
    const run: WebTool<VendorWebCall, HttpExecutor> = {
      wire,
      input,
      reads: webReads,
      targets: webTargets,
      run: (given, call) => searched(form, route, given, call),
    };
    return { tools: { websearch: run } };
  };
};

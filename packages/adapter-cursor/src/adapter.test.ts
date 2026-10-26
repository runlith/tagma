import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';
import { answering } from '@runlith/llm/route/transport/answering';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { adapter } from './adapter';
import { cursorSelection } from './selection';

const provider = adapter({ product: { mcpServer: 'test', client: { name: 'test', version: '1' } }, instances: [] })[0]!;
const credentials: ModelCredentials = {
  apiKey: async () => 'key',
  accessToken: async () => 'key',
  credential: async () => ({ accessToken: 'key', refreshToken: null, expiresAt: null, email: 'a@example.com' }),
};

it.effect('the catalog keeps context-specific capacity, native parameters and aliases without admitting unknown capacity', () =>
  Effect.gen(function* () {
    if (provider.kind !== 'harness' || provider.auth !== 'api-key') return yield* Effect.die('wrong provider kind');
    const http = answering(() =>
      Response.json({
        items: [
          { id: 'composer-2.5', displayName: 'Composer 2.5', aliases: ['composer'] },
          {
            id: 'future',
            displayName: 'Future',
            parameters: [
              { id: 'context', values: [{ value: '200k' }, { value: '1m' }] },
              { id: 'reasoning', values: [{ value: 'low' }, { value: 'high' }] },
              { id: 'fast', values: [{ value: 'true' }, { value: 'false' }] },
            ],
            variants: [
              {
                displayName: 'Default',
                isDefault: true,
                isMaxMode: true,
                params: [
                  { id: 'context', value: '1m' },
                  { id: 'reasoning', value: 'high' },
                  { id: 'fast', value: 'false' },
                ],
              },
            ],
          },
          { id: 'unknown', displayName: 'Unknown' },
        ],
      }),
    );
    const result = yield* provider.catalog!.read(credentials, 'owner').pipe(Effect.provideService(HttpClient.HttpClient, http));
    const catalog = modelCatalog([{ ...provider, ...result }]);
    expect(catalog.resolveTextModel('cursor', 'composer').id).toBe('composer-2.5');
    expect(catalog.resolveTextModel('cursor', 'future@context=1m').capacity?.context).toBe(1_000_000);
    expect(catalog.resolveTextModel('cursor', 'future@context=200k').capacity?.context).toBe(200_000);
    expect(catalog.resolveTextModel('cursor', 'future@context=1m').defaultReasoning).toBe('high');
    expect(cursorSelection('future@context=1m', 'high', { fast: 'false', maxMode: 'true' })).toEqual({
      id: 'future',
      params: [
        { id: 'fast', value: 'false' },
        { id: 'context', value: '1m' },
        { id: 'reasoning', value: 'high' },
      ],
      maxMode: true,
    });
    expect(result.warnings).toEqual(['Unknown: context window is unknown']);
  }),
);

it.effect('a pasted key is checked with Cursor and a rejected key retains the vendor reason', () =>
  Effect.gen(function* () {
    if (provider.kind !== 'harness' || provider.auth !== 'api-key') return yield* Effect.die('wrong provider kind');
    const key = provider.accounts.signIns.find((method) => method.kind === 'key')!;
    if (key.kind !== 'key') return yield* Effect.die('missing key sign-in');
    const refused = answering(() => Response.json({ error: 'Invalid API key' }, { status: 401 }));
    const failure = yield* Effect.flip(key.store('invalid').pipe(Effect.provideService(HttpClient.HttpClient, refused)));
    expect(failure.message).toContain('Invalid API key');
    const http = answering(() => Response.json({ userEmail: 'a@example.com' }));
    const expected = { accessToken: 'valid', refreshToken: null, expiresAt: null, email: 'a@example.com' };
    expect(yield* key.store('valid').pipe(Effect.provideService(HttpClient.HttpClient, http))).toEqual(expected);
  }),
);

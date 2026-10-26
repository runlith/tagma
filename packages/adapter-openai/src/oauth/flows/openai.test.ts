import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';
import { answering } from '@runlith/llm/route/transport/answering';
import { OPENAI_OAUTH_CLIENT_ID, openAIManualBegin, openAIRefresh } from './openai';

it.effect('manual sign-in identifies Tagma and retains its Codex OAuth grant', () =>
  Effect.gen(function* () {
    const start = yield* openAIManualBegin();
    const url = new URL(start.authorizeUrl);
    expect(url.searchParams.get('originator')).toBe('tagma');
    expect(url.searchParams.get('client_id')).toBe(OPENAI_OAUTH_CLIENT_ID);
    expect(url.searchParams.get('state')).toBe(start.state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  }),
);

it.effect('manual sign-in preserves the explicitly named caller', () =>
  Effect.gen(function* () {
    const start = yield* openAIManualBegin({ originator: 'other-client' });
    expect(new URL(start.authorizeUrl).searchParams.get('originator')).toBe('other-client');
  }),
);

const REFRESH_TOKEN = 'rt_a-chatgpt-refresh-token-worth-keeping';
const wireOf = (response: () => Response) => HttpClient.layerMergedContext(Effect.succeed(answering(response)));

it.effect('a refusal body echoing the posted refresh token reaches nobody', () =>
  Effect.gen(function* () {
    const wire = wireOf(() => new Response(JSON.stringify({ error: 'invalid_grant', refresh_token: REFRESH_TOKEN }), { status: 400 }));
    const failure = yield* Effect.flip(openAIRefresh(REFRESH_TOKEN).pipe(Effect.provide(wire)));
    expect(failure.message).not.toContain(REFRESH_TOKEN);
    expect(failure.message).toContain('<redacted>');
  }),
);

it.effect('a token response of the wrong shape does not print the credential it carried', () =>
  Effect.gen(function* () {
    const wire = wireOf(() => new Response(`not json at all: ${REFRESH_TOKEN}`, { status: 200 }));
    const failure = yield* Effect.flip(openAIRefresh(REFRESH_TOKEN).pipe(Effect.provide(wire)));
    expect(failure.message).not.toContain(REFRESH_TOKEN);
  }),
);

import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { answering, type Sent } from '@runlith/llm/route/transport/answering';
import { doorExecutorLayer } from '@runlith/llm/route/executor';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import type { ImageRequest } from '@runlith/llm/profiles/images';
import { openaiSubscriptionRegistration } from './openai';

const credentials: ModelCredentials = {
  apiKey: async () => 'unused',
  accessToken: async () => 'token',
  credential: async () => ({ accessToken: 'token', refreshToken: 'refresh', expiresAt: 0, accountId: 'account-1' }),
};

const subscription = openaiSubscriptionRegistration({ mcpServer: 'test', client: { name: 'test', version: '1.0.0' } });

const drawn = (request: Partial<ImageRequest>, respond: (sent: Sent) => Response) => {
  const sent: Sent[] = [];
  return subscription
    .images!.generate(
      { ownerId: 'owner', model: 'gpt-image-2', credentials },
      { model: 'gpt-image-2', prompt: 'a red circle', images: [], transparent: false, ...request },
    )
    .pipe(
      Effect.provide(
        doorExecutorLayer(
          answering((request) => {
            sent.push(request);
            return respond(request);
          }),
        ),
      ),
      Effect.result,
      Effect.map((result) => ({ result, sent })),
    );
};

describe('pictures the ChatGPT subscription draws', () => {
  it.effect('a spent picture limit is refused once, with the reset the vendor names', () =>
    Effect.gen(function* () {
      const { result, sent } = yield* drawn({}, () =>
        Response.json(
          { error: { type: 'usage_limit_reached', message: 'The usage limit has been reached', resets_at: 1_792_626_002 } },
          { status: 429, headers: { 'x-codex-active-limit': 'imagegen_premium', 'x-codex-primary-used-percent': '100' } },
        ),
      );
      expect(sent).toHaveLength(1);
      expect(result).toMatchObject({ _tag: 'Failure', failure: { reason: { _tag: 'QuotaExceeded', resetsAt: 1_792_626_002 } } });
    }),
  );

  it.effect('a request beyond what the model takes is refused before the wire', () =>
    Effect.gen(function* () {
      const picture = { bytes: new Uint8Array([1]), mediaType: 'image/png' };
      const tooMany = yield* drawn({ images: Array.from({ length: 6 }, () => picture) }, () => new Response('', { status: 500 }));
      const foreign = yield* drawn(
        { images: [{ bytes: new Uint8Array([1]), mediaType: 'image/tiff' }] },
        () => new Response('', { status: 500 }),
      );
      for (const { result, sent } of [tooMany, foreign]) {
        expect(sent).toHaveLength(0);
        expect(result).toMatchObject({ _tag: 'Failure', failure: { reason: { _tag: 'InvalidRequest' } } });
      }
    }),
  );
});

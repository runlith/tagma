import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Logger, References } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { MCP_SESSION_HEADER, SESSION_HEADER } from '../platform/contract/wire/session.js';
import { requestLine } from './door.js';

type Line = { readonly message: unknown; readonly annotations: Record<string, unknown> };

const answering = Effect.fnUntraced(function* (request: Request) {
  const lines: Line[] = [];
  const capture = Logger.make<unknown, void>((options) => {
    lines.push({ message: options.message, annotations: options.fiber.getRef(References.CurrentLogAnnotations) });
  });
  yield* requestLine(Effect.succeed(HttpServerResponse.empty({ status: 204 }))).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
    Effect.provide(Logger.layer([capture])),
  ) as Effect.Effect<unknown, never, never>;
  return lines as readonly Line[];
});

const asked = (headers: Record<string, string>): Request => new Request('http://tagma/api/commands?project=5&standing=true', { headers });

it.effect('the line names the harness a call is signed as, and never the key that proves it', () =>
  Effect.gen(function* () {
    const [line] = yield* answering(asked({ [SESSION_HEADER]: 'claude-code:a-secret-transcript-key' }));

    expect(line?.annotations['http.asked']).toBe('claude-code');
    expect(JSON.stringify(line)).not.toContain('a-secret-transcript-key');
  }),
);

it.effect('a call over the MCP bridge is told apart from the same CLI’s shell', () =>
  Effect.gen(function* () {
    const [bridged] = yield* answering(asked({ [MCP_SESSION_HEADER]: 'codex:another-key' }));
    expect(bridged?.annotations['http.asked']).toBe('codex/mcp');
    expect(JSON.stringify(bridged)).not.toContain('another-key');
  }),
);

it.effect('what was asked for and what it was answered with stand on the line, without the query it was asked with', () =>
  Effect.gen(function* () {
    const [line] = yield* answering(asked({}));

    expect(line?.annotations).toMatchObject({
      'http.method': 'GET',
      'http.url': '/api/commands',
      'http.status': 204,
    });
    expect(line?.annotations['http.asked']).toBeUndefined();
  }),
);

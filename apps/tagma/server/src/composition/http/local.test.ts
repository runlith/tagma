import { afterAll, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { localGate } from './local.js';

const SANDBOX = 5636;

const { handler, dispose } = HttpRouter.toWebHandler(HttpRouter.add('GET', '/api/ws', Effect.succeed(HttpServerResponse.text('ok'))), {
  disableLogger: true,
  middleware: localGate([SANDBOX]),
});

afterAll(() => dispose());

const asked = (headers: Record<string, string>, path = '/api/ws') => handler(new Request(`http://127.0.0.1:5633${path}`, { headers }));

test('a caller with no browser origin and a page of this machine reach the local door', async () => {
  expect((await asked({})).status).toBe(200);
  expect((await asked({ origin: 'http://127.0.0.1:5633' })).status).toBe(200);
  expect((await asked({ origin: 'http://localhost:5632' })).status).toBe(200);
});

test('an opaque view, the sandbox, a plugin site, another site and a rebound name are refused before the door answers', async () => {
  for (const headers of <Record<string, string>[]>[
    { origin: 'null' },
    { origin: `http://127.0.0.1:${SANDBOX}` },
    { origin: `http://music.localhost:${SANDBOX}` },
    { origin: 'http://music.localhost:5633' },
    { origin: 'https://evil.example' },
    { host: 'rebound.example:5633' },
    { host: `music.localhost:5633` },
  ]) {
    const answer = await asked(headers);
    expect(answer.status).toBe(403);
    expect(((await answer.json()) as { code: string }).code).toBe('origin-refused');
  }
});

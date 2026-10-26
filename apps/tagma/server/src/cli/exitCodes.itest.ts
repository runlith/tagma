import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { capturedEffect } from '../composition/testing/captured.js';
import type { RefusalBody } from '../platform/contract/wire/refusal.js';

const readMissing = ['op', 'read_block', '--json', JSON.stringify({ blockIds: ['deadbeef'] })];

const answering = (body: RefusalBody, status: number) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json(body, { status }) })),
    (server) => Effect.promise(() => server.stop(true)),
  );

it.live('a refusal exits 2 and prints its complete JSON body', () =>
  Effect.gen(function* () {
    const body: RefusalBody = { code: 'not-found', reason: 'no block deadbeef', unblock: ['search_blocks finds the block'] };
    const server = yield* answering(body, 409);
    const refused = yield* capturedEffect(readMissing, { TAGMA_SERVER_URL: `http://127.0.0.1:${server.port}` }, import.meta.dir);
    expect(refused.code).toBe(2);
    expect(JSON.parse(refused.out)).toEqual(body);
  }),
);

it.live('a server that is not there exits 1, not 2', () =>
  Effect.gen(function* () {
    const answered = yield* capturedEffect(readMissing, { TAGMA_SERVER_URL: 'http://127.0.0.1:1' }, import.meta.dir);
    expect(answered.code).toBe(1);
  }),
);

it.live('an undeclared 500 prints the fault body and exits 1', () =>
  Effect.gen(function* () {
    const body: RefusalBody = {
      code: 'server-fault',
      reason: 'this call broke inside the server: the shipped workflows are gone',
      unblock: ['this is a Tagma defect, not a gate: file it with the reason above'],
    };
    const server = yield* answering(body, 500);
    const answered = yield* capturedEffect(
      ['op', 'list_projects', '--json', '{}'],
      { TAGMA_SERVER_URL: `http://127.0.0.1:${server.port}` },
      import.meta.dir,
    );
    expect(answered.code).toBe(1);
    expect(answered.err).toContain(body.reason);
    expect(answered.err).toContain(`unblock: ${body.unblock[0]}`);
  }),
);

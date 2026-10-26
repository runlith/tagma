import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Cause, Context, Effect, Exit, Layer } from 'effect';
import { TestConsole } from 'effect/testing';
import { door } from '../../cli/door.js';
import { CallerSignal } from '../../../cli/door.js';
import { CurrentInvocation, Invocation, refusalOf } from '../../../platform/cli/verb.js';
import type { healthSchema } from '../../../http/contract/wire/health.js';
import { OUTCOME_HEADER } from '../../../invocation/contract/wire/headers.js';

const processState = {
  ok: true,
  version: '0.1.0',
  database: '/tmp/tagma.sqlite',
  schema: { applied: 1, latest: 'fixture-step' },
} as const;
const healthState: typeof healthSchema.Type = {
  ...processState,
  source: { cut: null, installation: { build: 'fixture-build', digest: 'sha256:aa' } },
  builds: { surface: { served: null }, host: { served: null } },
  standing: null,
  sessionIdentity: { prefix: {}, extras: [] },
  artifactOrigin: 'http://127.0.0.1:1',
  sandboxOrigin: null,
  stalled: null,
};
const STARTING = { code: 'server-starting', reason: 'the server is starting', unblock: ['wait until /health answers ready'] };
const setup = Effect.acquireRelease(
  Effect.sync(() => {
    let answer: unknown = healthState;
    let malformed = false;
    let refusals: { times: number; after: string | null } = { times: 0, after: null };
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        if (refusals.times > 0) {
          refusals.times -= 1;
          return Response.json(STARTING, {
            status: 503,
            headers: { [OUTCOME_HEADER]: 'refusal', ...(refusals.after === null ? {} : { 'retry-after': refusals.after }) },
          });
        }
        return malformed ? new Response('{') : Response.json(answer);
      },
    });
    const invocation = () =>
      new Invocation({ TAGMA_SERVER_URL: `http://127.0.0.1:${server.port}` }, '/', () => new Blob([]).stream(), '/main.ts');
    return {
      invocation,
      server,
      answer: (body: unknown) => {
        answer = body;
        malformed = false;
      },
      malformed: () => {
        malformed = true;
      },
      refuse: (times: number, after: string | null) => {
        answer = healthState;
        malformed = false;
        refusals = { times, after };
      },
    };
  }),
  ({ server }) => Effect.promise(() => server.stop(true)),
);
class Peer extends Context.Service<Peer, Effect.Success<typeof setup>>()('testing/Peer') {}
const health = (at: Invocation) => Effect.provideService(door.healthOrNone(), CurrentInvocation, at);
const ask = (at: Invocation) =>
  Effect.provideService(
    door.ask((client) => client.health.health()),
    CurrentInvocation,
    at,
  );

layer(Layer.effect(Peer, setup), { excludeTestServices: true })('CLI server door', (it) => {
  it.effect('a complete health answer carries its installation', () =>
    Effect.gen(function* () {
      const peer = yield* Peer;
      peer.answer(healthState);
      const whole = yield* health(peer.invocation());
      expect(whole).toMatchObject({ _tag: 'Health', health: { source: { installation: { build: 'fixture-build' } } } });
    }),
  );

  it.effect('a declared refusal stays a refusal; one naming when to ask again is asked again until answered, unless its caller left', () =>
    Effect.gen(function* () {
      const peer = yield* Peer;
      peer.refuse(2, '0');
      expect(yield* ask(peer.invocation())).toMatchObject({ ok: true, version: processState.version });
      peer.refuse(1, null);
      expect(refusalOf(yield* Effect.flip(ask(peer.invocation())))).toMatchObject({ code: 'server-starting' });
      peer.refuse(1, '0');
      const gone = Effect.provideService(ask(peer.invocation()), CallerSignal, AbortSignal.abort());
      expect(refusalOf(yield* Effect.flip(gone))).toMatchObject({ code: 'server-starting' });
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect('malformed health fails instead of reporting the serving process absent', () =>
    Effect.gen(function* () {
      const peer = yield* Peer;
      peer.answer(processState);
      const partial = yield* Effect.exit(health(peer.invocation()));
      expect(Exit.isFailure(partial)).toBe(true);
      if (Exit.isFailure(partial)) expect(Cause.squash(partial.cause)).toBeInstanceOf(Error);
      peer.malformed();
      const read = yield* Effect.exit(health(peer.invocation()));
      expect(Exit.isFailure(read)).toBe(true);
      if (Exit.isFailure(read)) expect(Cause.squash(read.cause)).toBeInstanceOf(Error);
    }),
  );
});

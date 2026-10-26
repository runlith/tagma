import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { makeDoorWorld } from '../doorFixture.js';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  return { world, projectId: yield* world.stealthProject() };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/SandboxImportPlace') {}

const importing = Effect.fnUntraced(function* (headers: Record<string, string>) {
  const { world, projectId } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/import_output?project=${projectId}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ sandbox: 'no-such-sandbox', from: 'generated.lock', to: 'generated.lock', expect: 'absent' }),
      }),
      world.runtime.graph,
    ),
  );
  return (yield* Effect.promise(() => response.json())) as { code?: string };
});

layer(Layer.effect(Place, setup), { excludeTestServices: true, testTimeout: 30_000, timeout: 60_000 })('sandbox import HTTP door', (it) => {
  it.effect('an import by a caller this server records no session for lands nothing, however it arrived', () =>
    Effect.gen(function* () {
      const unplaceable = grantEnvironment('thread-this-server-never-had', testSessionIdentity)[GRANT_VARIABLE] as string;
      const callers: readonly { readonly headers: Record<string, string>; readonly code: string }[] = [
        { headers: {}, code: 'thread-required' },
        { headers: { [GRANT_HEADER]: unplaceable }, code: 'grant-thread-gone' },
      ];
      for (const { headers, code } of callers) expect((yield* importing(headers)).code).toBe(code);
    }),
  );
});

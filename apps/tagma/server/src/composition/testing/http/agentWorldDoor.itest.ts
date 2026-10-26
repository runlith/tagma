import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { makeDoorWorld } from '../doorFixture.js';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const root = yield* world.directory('agent-world');
  const projectId = yield* world.stealthProject(root);
  const declaration = join(root, 'reader.md');
  yield* (yield* FileSystem.FileSystem).writeFileString(declaration, '---\ncapabilities: []\n---\nAnswer with one short paragraph.\n');
  return { world, projectId, declaration };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/AgentWorldPlace') {}

const bornThread = Effect.fnUntraced(function* (guest: boolean) {
  const { world, projectId } = yield* Place;
  const created = yield* world.call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: {} });
  expect(created.status).toBe(200);
  const id = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
  if (guest) {
    yield* Context.get(world.runtime.graph, MachineStore).db.run(
      sql`update thread_mandate set host_kind = 'sandbox', host_id = 'sbx-door' where id = ${id}`,
    );
  }
  return id;
});

const read = Effect.fnUntraced(function* (headers: Record<string, string>) {
  const { world, projectId, declaration } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/read_agent?project=${projectId}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ sourceFile: declaration }),
      }),
      world.routed,
    ),
  );
  const body: unknown = yield* Effect.promise(() => response.json().catch(() => null));
  return { status: response.status, body };
});
const previewAs = (threadId: string | null) =>
  read(threadId === null ? {} : { [GRANT_HEADER]: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string });

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 30_000,
  timeout: 60_000,
})('agent world HTTP door', (it) => {
  it.effect('a declaration file is read for a caller whose world is this checkout, and refused for one whose world is not', () =>
    Effect.gen(function* () {
      const operator = yield* previewAs(null);
      expect(operator.status).toBe(200);
      expect(JSON.stringify(operator.body)).toContain('one short paragraph');
      const local = yield* previewAs(yield* bornThread(false));
      expect(local.status).toBe(200);
      expect(JSON.stringify(local.body)).toContain('one short paragraph');
      const guest = yield* previewAs(yield* bornThread(true));
      expect(guest.status).toBe(409);
      expect(guest.body).toMatchObject({ code: 'world-unavailable' });
      const foreign = yield* read({ 'x-tagma-session': 'claude-code:transcript-1' });
      expect(foreign.status).toBe(200);
      expect(JSON.stringify(foreign.body)).toContain('one short paragraph');
    }),
  );
});

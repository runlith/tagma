import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { makeTerminalWorld } from '../fixture.js';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { session as sessionRow } from '../../../platform/store/writers.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { SHIPPED_HARNESSES, sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { suiteGit } from '../suiteGit.js';
import type { Environment } from '../../../platform/cli/verb.js';

const GONE = 'deleted-session';

const signer = '01a07000-0000-7000-8000-00000000000a';
const other = '01a07000-0000-7000-8000-00000000000b';

const setup = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  const { runtime, url } = world;
  const signedProject = yield* world.checkout();
  const root = signedProject.root;
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'root');
  const project = signedProject.name;
  return { world, runtime, url, project };
});

class Signature extends Context.Service<Signature, Effect.Success<typeof setup>>()('testing/NativeSignature') {}

const full = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Signature, ({ runtime }) => Effect.flatMap(runtime.runtime.contextEffect, (context) => Effect.provide(work, context)));

const projectId = (name: string) =>
  Effect.flatMap(Signature, ({ runtime }) =>
    Effect.map(full(Context.get(runtime.graph, Projects).resolve(name)), (row) => row?.id as number),
  );

const session = Effect.fnUntraced(function* (id: string, name: string, options: { parent?: string; aim?: string } = {}) {
  const { runtime, project } = yield* Signature;
  const store = Context.get(runtime.graph, MachineStore);
  yield* full(
    bornThread(
      store.db,
      {
        id,
        ownerId: 'owner',
        agentId: 'tagma',
        provider: 'openai-oauth',
        model: 'gpt-test',
        reasoning: 'high',
        authority: { mode: 'trust', bypassFrom: null },
        status: 'idle',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        spawnRootId: options.parent ?? id,
        cacheGroup: id,
        name,
        parentThreadId: options.parent,
      },
      {
        projectId: yield* projectId(options.aim ?? project),
        title: name,
        readerOrderAt: new Date(0),
      },
    ),
  );
});

const unsigned = (url: string): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env, TAGMA_SERVER_URL: url };
  for (const { variable } of SHIPPED_HARNESSES) if (variable !== undefined) delete env[variable];
  delete env[GRANT_VARIABLE];
  return env;
};

const spawnedIn = Effect.fnUntraced(function* (aim: string, env: Record<string, string | undefined>, ...argv: string[]) {
  const { world } = yield* Signature;
  return yield* world.spawned([...argv, '--project', aim], { env });
});

const submit = (aim: string, env: Environment, input: Record<string, unknown> = {}) =>
  Effect.flatMap(Signature, ({ world }) => world.tagma(['op', 'submit_work', '--json', JSON.stringify(input), '--project', aim], { env }));

const submitSpawned = (aim: string, env: Record<string, string | undefined>, input: Record<string, unknown> = {}) =>
  spawnedIn(aim, env, 'op', 'submit_work', '--json', JSON.stringify(input));

const door = Effect.fnUntraced(function* (headers: Record<string, string>, lens?: string, input: object = {}) {
  const { url, project } = yield* Signature;
  return yield* Effect.promise(async () => {
    const response = await fetch(`${url}/api/op/read_changes?${lens ?? `project=${project}`}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return (await response.json()) as { code?: string; subject?: string | null; holdings?: unknown[] };
  });
});

const carrying = (threadId: string) => ({ [GRANT_HEADER]: grantEnvironment(threadId, sessionIdentity)[GRANT_VARIABLE] as string });

const seeded = setup.pipe(
  Effect.tap((place) =>
    Effect.all([session(signer, 'signing-fox', { aim: place.project }), session(other, 'second-fox', { aim: place.project })]).pipe(
      Effect.provideService(Signature, place),
    ),
  ),
);

layer(Layer.effect(Signature, seeded).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('native signature', (it) => {
  it.effect('a Tagma-owned command keeps its proven identity inside a foreign harness', () =>
    Effect.gen(function* () {
      const { project, url } = yield* Signature;
      const signed = yield* submit(project, { ...unsigned(url), ...grantEnvironment(signer, sessionIdentity) });
      expect(signed.err).not.toContain('refused[no-record]');
      expect(signed.code).toBe(0);

      const foreign = yield* submitSpawned(project, {
        ...unsigned(url),
        ...grantEnvironment(signer, sessionIdentity),
        CLAUDE_CODE_SESSION_ID: 'cc-transcript',
      });
      expect(foreign.code).toBe(0);
      expect(foreign.err).not.toContain('refused[no-record]');
    }),
  );

  it.effect('the door answers the session a grant was minted for, and refuses a caller with none', () =>
    Effect.gen(function* () {
      expect((yield* door(carrying(signer))).subject).toContain(signer);
      expect((yield* door(carrying(other))).subject).toContain(other);
      expect((yield* door({})).code).toBe('no-record');
    }),
  );

  it.effect('a grant this server cannot place leaves the caller unsigned, and costs no ordinary read', () =>
    Effect.gen(function* () {
      const { project } = yield* Signature;
      const elsewhere = { [GRANT_HEADER]: `${signer}.a-grant-of-another-server` };

      const read = yield* door(elsewhere, `project=${project}`, { path: 'src/a.ts' });
      expect(read.code).toBeUndefined();
      expect(read.holdings).toEqual([]);

      const asked = yield* door(elsewhere);
      expect(asked.code).toBe('no-record');
      expect(asked.subject).toBeUndefined();
    }),
  );

  it.effect('a caller naming a session of this server in the session token is refused, never believed', () =>
    Effect.gen(function* () {
      const claimed = yield* door({ 'x-tagma-session': `tagma:${signer}` });
      expect(claimed.code).toBe('session-native');
      expect(claimed.subject).toBeUndefined();

      expect((yield* door(carrying(signer))).subject).toContain(signer);
    }),
  );

  it.effect('a deleted session signs nothing, and the refused call does not write it back', () =>
    Effect.gen(function* () {
      const { runtime, project } = yield* Signature;
      const store = Context.get(runtime.graph, MachineStore);
      yield* session(GONE, 'ghost-fox');
      const carried = carrying(GONE);
      yield* full(store.db.run(sql`delete from thread where id = ${GONE}`));

      const refused = yield* door(carried, `project=${project}`);
      expect(refused.code).toBe('grant-thread-gone');
      expect(refused.subject).toBeUndefined();

      const rows = yield* full(store.db.select().from(sessionRow).where(eq(sessionRow.key, GONE)));
      expect(rows).toEqual([]);
    }),
  );
});

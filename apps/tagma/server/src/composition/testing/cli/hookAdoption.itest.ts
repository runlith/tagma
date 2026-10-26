import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { AdoptionRig, HOOK_SPAWN_BUDGET_MS, SESSION, adoptionLayer } from './hookAdoptionRig.js';
import { mintShellKey, shellDigest } from '../../../platform/credentials/grants.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { TERMINAL_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { adoptionKeptName } from '../../../external-harnesses/contract/wire/adoption.js';
import { makeSessionBirths } from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { ModelChanges } from '../../../threads/contract/service/modelChanges.js';
import { WorkSpells } from '../../../thread-record/contract/service/spells.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { applyMigration, chain } from '../../../platform/store/chain.js';
import { fixtureMigrations } from '../migrations.js';

layer(adoptionLayer.pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 60_000,
  timeout: HOOK_SPAWN_BUDGET_MS,
})('hook adoption', (it) => {
  it.effect(
    'an ungranted hook in a Tagma shell asks to be adopted naming its CLI by the flag, then reports as the thread it was answered',
    () =>
      Effect.gen(function* () {
        const { world, bare, adoptedThread, facetOf, proxied, granting } = yield* AdoptionRig;
        const project = yield* world.checkout();
        const key = `adopt-${crypto.randomUUID()}`;
        const threadId = yield* adoptedThread(crypto.randomUUID(), project.id, key);
        const shell = mintShellKey();
        const proxy = yield* proxied(granting(threadId));
        const answered = yield* world.spawned(['hook', 'session-start', '--harness', 'codex'], {
          cwd: project.root,
          server: proxy.server,
          stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: key, cwd: project.root }),
          env: { ...bare(), [TERMINAL_VARIABLE]: shell },
        });
        expect(answered.code).toBe(0);
        expect(proxy.heard.adopts).toHaveLength(1);
        const asked = proxy.heard.adopts[0]!;
        expect(asked.body).toMatchObject({ shell, harness: 'codex', key, cwd: project.root });
        expect(asked.cwd).toBe(project.root);
        expect(asked.body.ancestry.length).toBeGreaterThanOrEqual(2);
        expect(asked.body.ancestry.length).toBeLessThanOrEqual(16);
        expect(asked.body.ancestry[1]).toBe(process.pid);
        expect(proxy.heard.reports.map((report) => report.grant)).toEqual([grantFor(threadId)]);
        expect(proxy.heard.reports[0]?.body).toMatchObject({ occasion: 'session-start', session: SESSION });
        expect((yield* facetOf(threadId))?.seen?.length).toBe(1);
      }),
  );

  it.effect('an ordinary hook after migration re-adopts into the same thread through the birth owner and session store', () =>
    Effect.gen(function* () {
      const { world, bare, store, adoptedThread, facetOf, proxied, owned } = yield* AdoptionRig;
      const files = yield* FileSystem.FileSystem;
      const project = yield* world.checkout();
      const key = `witness-${crypto.randomUUID()}`;
      const threadId = yield* adoptedThread(crypto.randomUUID(), project.id, key);
      const shell = mintShellKey();
      const temporary = yield* world.directory('witness-cache');
      const migration = chain(fixtureMigrations).find((step) => step.name === '20261011042000_adopted_job_witness');
      expect(migration, 'the witness migration is not shipped').toBeDefined();
      yield* owned(
        Effect.gen(function* () {
          yield* store.db.run(sql`update external_session set facet = json_remove(facet, '$.session.job.birth') where id = ${threadId}`);
          yield* applyMigration(store.db, migration!);
        }),
      );
      expect((yield* facetOf(threadId))?.session).toMatchObject({ state: 'ended', endedReason: 'identity-unproven' });
      yield* files.writeFileString(
        join(temporary, adoptionKeptName(key)),
        JSON.stringify({ shell: shellDigest(shell), grant: grantFor(threadId), session: SESSION, threadId }),
      );
      const job = { pid: 12, birth: 'new-native-witness' };
      const proxy = yield* proxied((ask) =>
        owned(
          Effect.gen(function* () {
            const records = Context.get(world.runtime.owners, ThreadRecords);
            const units = yield* MachineUnits;
            const births = yield* makeSessionBirths;
            const birth = yield* births.adopt({ projectId: project.id, harness: ask.harness, key: ask.key, mode: 'trust' });
            const sessions = yield* sessionStoreOver(
              store.db,
              units,
              Context.get(world.runtime.owners, WorkSpells),
              records,
              Context.get(world.runtime.owners, ModelChanges),
              () => Effect.void,
            );
            const session = yield* sessions.adopted(
              birth.threadId,
              { shell: { execution: 'operator-shell', incarnation: 0 }, job, key: ask.key, cwd: project.root },
              'fixture',
            );
            return Response.json({
              status: 'adopted',
              threadId: birth.threadId,
              grant: grantFor(birth.threadId),
              session: session.id,
              job,
            });
          }),
        ).pipe(Effect.orDie),
      );
      const answer = yield* world.tagma(['hook', 'observe', '--harness', 'claude-code'], {
        cwd: project.root,
        server: proxy.server,
        env: { ...bare(), TMPDIR: temporary, [TERMINAL_VARIABLE]: shell },
        stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: key, prompt_id: 're-adopted-turn', cwd: project.root }),
      });
      expect(answer.code).toBe(0);
      const restored = yield* facetOf(threadId);
      expect(restored?.session).toMatchObject({ origin: 'adopted', state: 'running', job });
      expect(restored?.session?.id).not.toBe(SESSION);
      expect(proxy.heard.reports[0]).toMatchObject({ grant: grantFor(threadId), body: { session: restored?.session?.id } });
    }),
  );

  it.effect('without the flag the CLI is the row whose published session id is the event’s, and no matching row asks nothing', () =>
    Effect.gen(function* () {
      const { world, bare, adoptedThread, proxied, granting } = yield* AdoptionRig;
      const project = yield* world.checkout();
      const key = `published-${crypto.randomUUID()}`;
      const threadId = yield* adoptedThread(crypto.randomUUID(), project.id, key);
      const shell = mintShellKey();
      const proxy = yield* proxied(granting(threadId));
      yield* world.tagma(['hook', 'session-start'], {
        cwd: project.root,
        server: proxy.server,
        stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: key, cwd: project.root }),
        env: { ...bare(), [TERMINAL_VARIABLE]: shell, GROK_SESSION_ID: key, CLAUDE_CODE_SESSION_ID: 'the-outer-claude' },
      });
      expect(proxy.heard.adopts.map((adopt) => adopt.body.harness)).toEqual(['grok']);

      yield* world.tagma(['hook', 'session-start'], {
        cwd: project.root,
        server: proxy.server,
        stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: `nobody-${crypto.randomUUID()}`, cwd: project.root }),
        env: { ...bare(), [TERMINAL_VARIABLE]: shell, CLAUDE_CODE_SESSION_ID: 'the-outer-claude' },
      });
      expect(proxy.heard.adopts).toHaveLength(1);
    }),
  );
});

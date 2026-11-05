import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { makeThreadEntryReader, ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer, Result } from 'effect';
import { ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { ThreadJournal } from '../../../threads/contract/service/engine.js';
import { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';
import { birthsOf, exportThreadRollout, threadEntry } from '../../../threads/testing/doubles.js';
import { assemble } from '../../manifest.js';
import { makeRuntime } from '../../runtime.js';
import { TESTING_ADAPTERS } from '../adapters.js';
import { chosenModel } from '../chosenModel.js';
import { COMPOSED } from '../composed.js';
import { RIG_PARTS, RIG_STEP } from './journalRig.js';

it.live(
  'a step back returns every record of a thread the leaving build wrote in a form the build before lacks, in its rows and its file, and sets its form mark on that build last step',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'journal-return-' });
      const data = join(root, 'data');
      const assembly = yield* Effect.promise(() => assemble(RIG_PARTS));
      const kinds = assembly.entryKinds;
      const runtime = yield* makeRuntime(
        {
          ...COMPOSED,
          assembly,
          grants: testGrantSigner,
          databasePath: join(data, 'tagma.sqlite'),
          seedPath: join(root, 'seeds'),
          tokensPath: join(data, 'tokens.json'),
          attachmentsPath: join(data, 'attachments'),
          sourcePath: join(root, 'source'),
          drivers: [],
          adapters: TESTING_ADAPTERS,
        },
        Layer.empty,
        yield* sharedPool,
      );
      yield* chosenModel(runtime);
      const checkout = join(root, 'project');
      yield* files.makeDirectory(checkout, { recursive: true });
      const project = yield* Context.get(runtime.graph, ProjectLifecycle)
        .create({ name: 'tools', rootPath: checkout })
        .pipe(Effect.provide(runtime.graph));
      const born = yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null, title: 'tools' });
      const threadId = born.thread.id;
      const store = Context.get(runtime.graph, MachineStore);
      const units = Context.get(runtime.graph, MachineUnits);
      const journal = Context.get(runtime.owners, ThreadJournal);
      const entry = { type: 'tool', id: 'tool:r:c', runId: 'r', toolName: 'rigged__deal', toolCallId: 'c', toolState: 'output-available' };
      yield* units.write('testing.leavingForm', (tx) =>
        Effect.gen(function* () {
          yield* journal.append({ threadId, id: `${threadId}:event:0`, kind: 'tool', payload: { entry } }, tx);
          yield* tx.run(store.db.insert(threadEntry()).values({ threadId, ord: 1, entryId: entry.id, type: 'tool', entry }));
        }),
      );
      const rollouts = Context.get(runtime.owners, ThreadRollouts);
      const path = yield* rollouts.locate(threadId);
      if (path === undefined) return yield* Effect.die('the thread has no rollout place');
      yield* exportThreadRollout({ threadId, path, parts: yield* nativeOnlyParts }).pipe(
        Effect.provideService(MachineStore, store),
        Effect.provideService(ThreadEntryKinds, kinds),
      );
      expect(readFileSync(path, 'utf8')).toContain('rigged__deal');

      const carried = new Set(kinds.steps.map((step) => step.name).filter((name) => name !== RIG_STEP.name));
      const answer = yield* rollouts.returnOnto({ carried, since: new Date(0) });

      expect(answer).toMatchObject({ kept: [], unreturned: [] });
      const target = makeThreadEntryReader({ products: [], steps: kinds.steps.filter((step) => carried.has(step.name)) });
      const [row] = yield* store.db.all<{ entry: string }>(sql`select entry from thread_entry where thread_id = ${threadId}`);
      expect(Result.getOrThrow(target.decode(JSON.parse(row!.entry)))).toMatchObject({ toolName: 'rig__deal' });
      const [event] = yield* store.db.all<{ payload: string }>(sql`select payload from thread_event where thread_id = ${threadId}`);
      expect(JSON.parse(event!.payload)).toMatchObject({ entry: { toolName: 'rig__deal' } });
      const file = readFileSync(path, 'utf8');
      expect(file).toContain('"rig__deal"');
      expect(file).not.toContain('rigged__deal');
      expect(yield* store.db.all(sql`select step from thread_rollout_form where thread_id = ${threadId}`)).toEqual([
        { step: [...carried].toSorted().at(-1) },
      ]);
    }).pipe(Effect.provide(BunFileSystem.layer), Effect.scoped),
);

import { expect } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { assemble, type Assembly } from '../../manifest.js';
import { makeRuntime } from '../../runtime.js';
import { TESTING_ADAPTERS } from '../adapters.js';
import { chosenModel } from '../chosenModel.js';
import { COMPOSED } from '../composed.js';
import { RIG_PARTS, RIG_REFUSED, RIG_STEP } from './journalRig.js';

const world = Effect.fnUntraced(function* (assembly: Assembly) {
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.makeTempDirectoryScoped({ prefix: 'journal-return-' });
  const data = join(root, 'data');
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
  const store = Context.get(runtime.graph, MachineStore);
  const units = Context.get(runtime.graph, MachineUnits);
  const journal = Context.get(runtime.owners, ThreadJournal);
  const rollouts = Context.get(runtime.owners, ThreadRollouts);
  const kinds = assembly.entryKinds;
  const threadWith = Effect.fnUntraced(function* (toolName: string) {
    const born = yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null, title: 'tools' });
    const threadId = born.thread.id;
    const entry = { type: 'tool', id: 'tool:r:c', runId: 'r', toolName, toolCallId: 'c', toolState: 'output-available' };
    yield* units.write('testing.leavingForm', (tx) =>
      Effect.gen(function* () {
        yield* journal.append({ threadId, id: `${threadId}:event:0`, kind: 'tool', payload: { entry } }, tx);
        yield* tx.run(store.db.insert(threadEntry()).values({ threadId, ord: 1, entryId: entry.id, type: 'tool', entry }));
      }),
    );
    const path = yield* rollouts.locate(threadId);
    if (path === undefined) return yield* Effect.die('the thread has no rollout place');
    yield* exportThreadRollout({ threadId, path, parts: yield* nativeOnlyParts }).pipe(
      Effect.provideService(MachineStore, store),
      Effect.provideService(ThreadEntryKinds, kinds),
    );
    return { threadId, path };
  });
  const markOf = (threadId: string) => store.db.all(sql`select step from thread_rollout_form where thread_id = ${threadId}`);
  return { store, rollouts, kinds, threadWith, markOf };
});

it.live(
  'a step back returns every record of a thread the leaving build wrote in a form the build before lacks, in its rows and its file, and sets its form mark on that build last step; a record its back form refuses leaves only its thread as it stood',
  () =>
    Effect.gen(function* () {
      const { store, rollouts, kinds, threadWith, markOf } = yield* world(yield* Effect.promise(() => assemble(RIG_PARTS)));
      const { threadId, path } = yield* threadWith('rigged__deal');
      const refusing = yield* threadWith(RIG_REFUSED);
      expect(readFileSync(path, 'utf8')).toContain('rigged__deal');

      const carried = new Set(kinds.steps.map((step) => step.name).filter((name) => name !== RIG_STEP.name));
      const answer = yield* rollouts.returnOnto({ carried, since: new Date(0) });

      expect(answer).toMatchObject({
        kept: [],
        unreturned: [{ threadId: refusing.threadId, reason: expect.stringContaining('no name to return to') }],
      });
      const target = makeThreadEntryReader({ products: [], steps: kinds.steps.filter((step) => carried.has(step.name)) });
      const [row] = yield* store.db.all<{ entry: string }>(sql`select entry from thread_entry where thread_id = ${threadId}`);
      expect(Result.getOrThrow(target.decode(JSON.parse(row!.entry)))).toMatchObject({ toolName: 'rig__deal' });
      const [event] = yield* store.db.all<{ payload: string }>(sql`select payload from thread_event where thread_id = ${threadId}`);
      expect(JSON.parse(event!.payload)).toMatchObject({ entry: { toolName: 'rig__deal' } });
      const file = readFileSync(path, 'utf8');
      expect(file).toContain('"rig__deal"');
      expect(file).not.toContain('rigged__deal');
      expect(yield* markOf(threadId)).toEqual([{ step: [...carried].toSorted().at(-1) }]);
      const [kept] = yield* store.db.all<{ payload: string }>(sql`select payload from thread_event where thread_id = ${refusing.threadId}`);
      expect(JSON.parse(kept!.payload)).toMatchObject({ entry: { toolName: RIG_REFUSED } });
    }).pipe(Effect.provide(BunFileSystem.layer), Effect.scoped),
);

it.live(
  'a step back whose leaving steps carry no form for the rollout file only lowers the mark of a thread past the build before, keeping its file and transcript',
  () =>
    Effect.gen(function* () {
      const { rollouts, kinds, threadWith, markOf } = yield* world(COMPOSED.assembly);
      const { threadId, path } = yield* threadWith('read');
      const transcript = `${path}.entries`;
      writeFileSync(transcript, 'folded by the leaving build');
      const before = readFileSync(path, 'utf8');
      const newest = kinds.steps.at(-1)!;
      expect(newest.back).toBeUndefined();
      expect(yield* markOf(threadId)).toEqual([{ step: newest.name }]);

      const carried = new Set(kinds.steps.slice(0, -1).map((step) => step.name));
      const answer = yield* rollouts.returnOnto({ carried, since: new Date(0) });

      expect(answer).toMatchObject({ kept: [newest.name], unreturned: [] });
      expect(yield* markOf(threadId)).toEqual([{ step: kinds.steps.at(-2)!.name }]);
      expect([readFileSync(path, 'utf8') === before, existsSync(transcript)]).toEqual([true, true]);
    }).pipe(Effect.provide(BunFileSystem.layer), Effect.scoped),
);

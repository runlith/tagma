import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { born, hookThreads, unsigned } from '../hookFixture.js';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { instructionSetSchema } from '../../../graph/contract/wire/instructions.js';
import { blockName } from '../../../graph/contract/wire/references.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { HarnessOwner, NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { WorkPlaces } from '../../../threads/contract/service/working.js';
import { ModelChanges } from '../../../threads/contract/service/modelChanges.js';
import { workspaceChange } from '../../../change-record/testing/doubles.js';
import { workspaceChangeText } from '../../../change-record/store/tables.js';
import { sessionFor } from '../../../external-harnesses/testing/sessions.js';
import { acpTestKernel } from '../../../external-harnesses/testing/seats.js';
import { HarnessGuidance } from '../../../external-harnesses/contract/service/guidance.js';
import { guidanceSourcesOver } from '../../../external-harnesses/testing/guidance.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { WorkSpells } from '../../../thread-record/contract/service/spells.js';
import type { ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { ORIENTATION_OPERATIONS } from '../../../graph/contract/wire/operations/orientation.js';
import { makeTerminalWorld } from '../fixture.js';
import { suiteGit } from '../suiteGit.js';

const snapshot = Schema.Record(Schema.String, instructionSetSchema);

const setup = Effect.gen(function* () {
  const clock = yield* TestClock.make();
  const world = yield* makeTerminalWorld();
  const files = yield* FileSystem.FileSystem;
  const home = yield* world.checkout();
  const foreign = yield* world.checkout();
  yield* files.writeFileString(join(foreign.root, 'gate.ts'), 'export const value = 1;\n');
  yield* files.writeFileString(join(foreign.root, 'peer.ts'), 'export const peer = 1;\n');
  yield* files.writeFileString(join(home.root, 'home.ts'), 'export const home = 1;\n');
  for (const root of [home.root, foreign.root]) {
    yield* suiteGit(root, 'init', '-q', '-b', 'main');
    yield* suiteGit(root, 'add', '-A');
    yield* suiteGit(root, 'commit', '-q', '-m', 'seed');
  }
  const blocks = Context.get(world.runtime.graph, Blocks);
  const owned = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.provide(work, world.runtime.owners);
  const homeRule = blockName((yield* owned(blocks.create({ projectId: home.id, tags: ['rule'], title: 'Правило дома' }))).uuid);
  const foreignRule = blockName((yield* owned(blocks.create({ projectId: foreign.id, tags: ['rule'], title: 'Правило места' }))).uuid);
  const regionalRule = blockName(
    (yield* owned(
      blocks.create({ projectId: foreign.id, tags: ['rule'], title: 'Правило файла', sources: [{ kind: 'file', ref: 'gate.ts' }] }),
    )).uuid,
  );
  yield* world.warm(home.id);
  yield* world.warm(foreign.id);
  const sessions = yield* sessionStoreOver(
    Context.get(world.runtime.graph, MachineStore).db,
    Context.get(world.runtime.graph, MachineUnits),
    Context.get(world.runtime.owners, WorkSpells),
    Context.get(world.runtime.owners, ThreadRecords),
    Context.get(world.runtime.owners, ModelChanges),
    () => Effect.void,
  );
  const sources = yield* owned(guidanceSourcesOver(sessions));
  return { clock, world, home, foreign, homeRule, foreignRule, regionalRule, owned, sources };
});

class HookPlace extends Context.Service<HookPlace, Effect.Success<typeof setup>>()('testing/HookPlace') {}

const hook = Effect.fnUntraced(function* (event: string, root: string, payload: Record<string, unknown>, id: string) {
  const { world, clock } = yield* HookPlace;
  return yield* world.tagma(['hook', event], {
    cwd: root,
    stdin: JSON.stringify(payload),
    env: { ...unsigned(), ...grantEnvironment(id, sessionIdentity) },
    clock,
  });
});

const open = Effect.fnUntraced(function* (id: string, acp: boolean) {
  const { world, home, owned } = yield* HookPlace;
  const native = Context.get(world.runtime.owners, NativeStorage);
  const facet = born('devin', id);
  yield* hookThreads(world).bornThread(id, home.id, facet);
  yield* owned(native.threads.update(id, { authority: { mode: 'bypass', bypassFrom: null } }));
  if (acp) yield* owned(sessionFor(Context.get(world.runtime.graph, MachineStore).db, id, facet, acpTestKernel('devin', null, undefined)));
  const thread = yield* owned(native.threads.find(id));
  expect(thread, 'the fixture did not create its thread').toBeDefined();
  const started = yield* owned(
    native.runs(Context.get(world.runtime.owners, HarnessOwner).id).createRun({
      startFrom: thread!,
      kind: 'turn',
      approval: { mode: 'bypass', interactive: false },
      progress: { stage: 'running', message: null },
    }),
  );
  return { thread: thread!, run: started.run };
});

const laws = (law: unknown) =>
  Object.fromEntries(
    Object.entries(Schema.decodeUnknownSync(snapshot)(law)).map(([project, set]) => [
      project,
      set.entries.filter((entry) => entry.kind === 'law').map((entry) => entry.source),
    ]),
  );

const event = (id: string, path: string, cwd: string) => ({
  tool_name: 'edit',
  tool_input: { file_path: path, old_string: '1', new_string: '2' },
  session_id: id,
  cwd,
});

const post = Effect.fnUntraced(function* (url: string, headers: Record<string, string>, body: string) {
  return yield* Effect.promise(() => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));
});

layer(Layer.effect(HookPlace, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 60_000,
  timeout: 30_000,
})('hook place', (it) => {
  it.effect('a terminal hook records the foreign checkout under the thread’s home and keeps its full law beside the home snapshot', () =>
    Effect.gen(function* () {
      const { world, home, foreign, homeRule, foreignRule, regionalRule, owned, sources } = yield* HookPlace;
      const files = yield* FileSystem.FileSystem;
      const native = Context.get(world.runtime.owners, NativeStorage);
      const id = '01a12792-0000-7000-8000-000000000001';
      const opened = yield* open(id, false);
      const guiding = Context.get(world.runtime.owners, ThreadHarness).runs.guidance();
      const initial = yield* owned(guiding.prompt(opened.thread, opened.run, { projectId: 0, inputs: [] }, sources));
      yield* owned(initial.delivered);
      const path = join(foreign.root, 'gate.ts');
      const payload = { ...event(id, 'gate.ts', foreign.root) };
      yield* hook('pre-tool-use', home.root, payload, id);
      yield* files.writeFileString(path, 'export const value = 2;\n');
      yield* hook('post-tool-use', home.root, payload, id);
      const rows = yield* owned(
        Context.get(world.runtime.graph, MachineStore)
          .db.select({
            ...getTableColumns(workspaceChange()),
            oldText: workspaceChangeText.oldText,
            newText: workspaceChangeText.newText,
          })
          .from(workspaceChange())
          .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange().id))
          .where(and(eq(workspaceChange().projectId, foreign.id), eq(workspaceChange().path, 'gate.ts'))),
      );
      expect(rows.map((row) => [row.holder, row.holderProjectId, row.oldText, row.newText])).toEqual([
        [id, home.id, 'export const value = 1;\n', 'export const value = 2;\n'],
      ]);
      const transcript = yield* owned(native.threads.transcriptWindow(id, { limit: 20, bytes: 262144 }));
      const frame = transcript?.entries.findLast((entry) => entry.type === 'runtime-guidance');
      expect(frame?.type === 'runtime-guidance' && 'sources' in frame, 'the hook recorded no guidance').toBe(true);
      if (frame?.type !== 'runtime-guidance' || !('sources' in frame)) return;
      const delivered = laws(frame.sources.find((source) => source.ruleId === 'prompt')?.state?.law);
      expect(delivered[String(home.id)]).toContain(homeRule);
      expect(delivered[String(foreign.id)]).toContain(foreignRule);
      expect(delivered[String(foreign.id)]).not.toContain(regionalRule);
      expect(yield* owned(Context.get(world.runtime.owners, WorkPlaces).held(id))).toEqual([{ projectId: foreign.id, root: foreign.root }]);
    }),
  );

  it.effect('the first graph-only ACP act delivers place law as a refusal and restored guidance survives a context clear', () =>
    Effect.gen(function* () {
      const { world, home, foreign, homeRule, foreignRule, owned, sources } = yield* HookPlace;
      const native = Context.get(world.runtime.owners, NativeStorage);
      const id = '01a12792-0000-7000-8000-000000000002';
      const opened = yield* open(id, true);
      const guiding = Context.get(world.runtime.owners, ThreadHarness).runs.guidance();
      const question = post(
        `${world.url}/api/op/create_block?project=${foreign.id}`,
        { [GRANT_HEADER]: grantFor(id) },
        JSON.stringify({ title: 'A note of the place' }),
      );
      const first = yield* question;
      expect(first.status).toBe(409);
      const refusal = (yield* Effect.promise(() => first.json())) as { code: string };
      expect(refusal.code).toBe('instructions-unread');
      const transcript = yield* owned(native.threads.transcriptWindow(id, { limit: 20, bytes: 262144 }));
      const told = transcript?.entries.findLast((entry) => entry.type === 'runtime-guidance');
      expect(told?.type === 'runtime-guidance' && 'sources' in told, 'the graph-only act delivered no law').toBe(true);
      if (told?.type !== 'runtime-guidance' || !('sources' in told)) return;
      expect(laws(told.sources.find((source) => source.ruleId === 'prompt')?.state?.law)[String(foreign.id)]).toContain(foreignRule);
      expect((yield* question).status).toBe(200);
      const cleared = yield* owned(Context.get(world.runtime.owners, HarnessGuidance).cleared(id, 'clear-place-context'));
      yield* owned(native.threads.transaction((tx) => cleared.plan.run(tx as unknown as ThreadWriteTx)));
      yield* owned(cleared.delivered);
      const oriented = yield* owned(guiding.prompt(opened.thread, opened.run, { projectId: 0, inputs: [] }, sources));
      const frame = oriented.events.find((one) => one.kind === 'runtime-guidance');
      const entry = frame?.payload.entry;
      const states = entry !== undefined && 'sources' in entry ? entry.sources : [];
      const delivered = laws(states.find((source) => source.ruleId === 'prompt')?.state?.law);
      expect(delivered[String(home.id)]).toContain(homeRule);
      expect(delivered[String(foreign.id)]).toContain(foreignRule);
    }),
  );

  it.effect('a multi-project touch groups checkouts and a delayed guide delivers their current law', () =>
    Effect.gen(function* () {
      const { world, home, foreign, homeRule, owned } = yield* HookPlace;
      const files = yield* FileSystem.FileSystem;
      const native = Context.get(world.runtime.owners, NativeStorage);
      const id = '01a12792-0000-7000-8000-000000000003';
      yield* open(id, false);
      const outside = join(yield* world.directory('outside'), 'file.ts');
      yield* files.writeFileString(outside, 'export const outside = 1;\n');
      const shown = [
        { path: join(home.root, 'home.ts'), as: 'read' },
        { path: join(foreign.root, 'gate.ts'), as: 'read' },
        { path: join(foreign.root, 'peer.ts'), as: 'read' },
        { path: outside, as: 'read' },
      ];
      const response = yield* post(
        `${world.url}/api/op/touch_path?cwd=${encodeURIComponent(home.root)}`,
        { [GRANT_HEADER]: grantFor(id) },
        JSON.stringify({ shown }),
      );
      const touched = yield* Schema.decodeUnknownEffect(knownAnswer(ORIENTATION_OPERATIONS.touch_path.answer))(
        yield* Effect.promise(() => response.json()),
      );
      expect(touched.status, 'the touch did not answer its groups').toBe('ok');
      if (touched.status !== 'ok') return;
      expect(touched.places.map((place) => place.projectId).toSorted()).toEqual([home.id, foreign.id].toSorted());
      expect(touched.briefs.map((brief) => brief.place).toSorted()).toEqual(
        shown
          .filter((one) => one.path !== outside)
          .map((one) => one.path)
          .toSorted(),
      );
      const served = yield* owned(world.runtime.pool.resolve({ projectId: foreign.id }));
      const added = yield* Context.get(served.context, Blocks)
        .create({ projectId: foreign.id, tags: ['rule'], title: 'Правило после touch' })
        .pipe(Effect.provide(served.context));
      yield* owned(Context.get(world.runtime.owners, HarnessGuidance).touch(id, 'delayed-current-law', touched.briefs, touched.places));
      const transcript = yield* owned(native.threads.transcriptWindow(id, { limit: 20, bytes: 262144 }));
      const frame = transcript?.entries.findLast((entry) => entry.type === 'runtime-guidance');
      expect(frame?.type === 'runtime-guidance' && 'sources' in frame, 'the guide recorded no current law').toBe(true);
      if (frame?.type !== 'runtime-guidance' || !('sources' in frame)) return;
      const delivered = laws(frame.sources.find((source) => source.ruleId === 'prompt')?.state?.law);
      expect(delivered[String(foreign.id)]).toContain(blockName(added.uuid));
      expect(delivered[String(home.id)]).toContain(homeRule);
    }),
  );
});

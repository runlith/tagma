import { unthreadedCaller } from '../callers';
import { fixtureGraphMigrations, fixtureMigrations } from '../migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Path } from 'effect';
import { Git } from '@runlith/git/Git';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { MachineStore, type Store, type StoreBrand } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededMachineLayer, seededStoreLayer } from '../../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { heldTasks } from '../../../graph/work/tasksHeld.js';
import type { HeldTaskLabels } from '../../../change-record/contract/service/taskLabels.js';
import { block, blockField, blockTag } from '../../../graph/store/tables.js';
import { project } from '../../../projects/store/table.js';
import { session } from '../../../platform/store/writers.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { scopeRecord, shelveRecord } from '../../../thread-record/testing/records.js';
import { workspaceChange, workspaceChangeText, workspaceChangeContent } from '../../../change-record/store/tables.js';
import type { PlacedPath } from '../../../workspace/contract/wire/place.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import type { WorkspaceChange } from '@runlith/files/change';
import { changeRecordOf, intakeOf, retireStoreOf } from '../../../change-record/testing/doubles.js';
import { liveGitLayer } from '../liveGit.js';
import { gitEffect } from '../graphFixture.js';
import { tagsOfCatalogs } from '../../../catalogs/contract/wire/registry.js';
import { TagIndex } from '../../../graph/vocabulary/tagIndex.js';
import { turnsOf } from '../../../change-record/changes/turns.js';
import { evidenceInGroups, evidenceOfPath, heldOfThread } from '../../../change-record/record/evidence.js';
import { resolveHandover } from '../../../change-record/record/sessions.js';
import { addressOf } from '../../../thread-record/identity.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { BEHAVIOUR_REGISTRY } from '../../manifest.js';

const ROOT = '/work/repo';

const machineLayers = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededMachineLayer(fixtureMigrations, {}, sharedPool))),
  Layer.provideMerge(Layer.mergeAll(liveGitLayer, BunFileSystem.layer, Path.layer)),
);

const CHECKOUT = 'repo';

const recorder = Effect.fnUntraced(function* (
  units: MachineUnits['Service'],
  store: MachineStore['Service'],
  projectId: number,
  root: string,
  threadId: string,
) {
  const paths = yield* fixedCheckoutPaths(projectId, [{ checkout: CHECKOUT, root }]);
  const intake = yield* intakeOf(store, units, yield* Git, paths);
  return {
    record: (change: WorkspaceChange) =>
      Effect.map(intake.report({ projectId, holder: { kind: 'thread', thread: threadId } }, [change]), (places) => places.length > 0),
    port: (yield* changeRecordOf(store, units, paths, intake)).changes({ work: { projectId, threadId } }),
  };
});

const spelled = (path: string): PlacedPath => ({ checkout: CHECKOUT, path });

it.live('each session reads its own changes, and a path names every session holding it', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    yield* store.db.insert(session).values([
      { id: 1, harness: 'tagma', key: 'thread-one', createdAt: new Date(0) },
      { id: 2, harness: 'tagma', key: 'thread-two', createdAt: new Date(0) },
    ]);
    const agent = {
      ownerId: 'owner',
      agentId: 'tagma',
      provider: 'openai-oauth' as const,
      model: 'gpt-test',
      reasoning: 'high' as const,
      authority: { mode: 'trust' as const, bypassFrom: null },
      status: 'idle' as const,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    yield* bornThread(store.db, { ...agent, id: 'thread-one', spawnRootId: 'thread-one', cacheGroup: 'thread-one', name: 'reader' });
    yield* bornThread(store.db, {
      ...agent,
      id: 'thread-two',
      spawnRootId: 'thread-one',
      cacheGroup: 'thread-one',
      parentThreadId: 'thread-one',
      name: 'builder',
    });
    yield* scopeRecord(store.db, 'thread-one', { projectId: 1, title: 'Reader', readerOrderAt: new Date(0) });
    yield* scopeRecord(store.db, 'thread-two', { projectId: 1, title: 'Builder', readerOrderAt: new Date(0) });
    yield* store.db.insert(block).values([
      {
        id: 1,
        projectId: 1,
        uuid: '00000000-0000-0000-0000-000000000001',
        parentId: null,
        ord: 0,
        tags: ['task'],
        title: 'Read the change',
        body: '',
        fields: { status: 'in_work', holder: 1 },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      {
        id: 2,
        projectId: 1,
        uuid: '00000000-0000-0000-0000-000000000002',
        parentId: null,
        ord: 1,
        tags: ['task'],
        title: 'Build the change',
        body: '',
        fields: { status: 'in_work', holder: 2 },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);
    yield* store.db.insert(blockTag).values([
      { blockId: 1, tag: 'task' },
      { blockId: 2, tag: 'task' },
    ]);
    yield* store.db.insert(blockField).values([
      { blockId: 1, tag: 'task', name: 'status', value: 'in_work' },
      { blockId: 1, tag: 'task', name: 'holder', value: '1' },
      { blockId: 2, tag: 'task', name: 'status', value: 'in_work' },
      { blockId: 2, tag: 'task', name: 'holder', value: '2' },
    ]);

    const first = yield* recorder(units, store, 1, ROOT, 'thread-one');
    const second = yield* recorder(units, store, 1, ROOT, 'thread-two');

    yield* first.record({
      origin: 'edit',
      path: `${ROOT}/src/a.ts`,
      at: new Date(1_000),
      hunk: { firstLine: 12, oldLines: 3, newLines: 3, windowBefore: 0, oldText: 'was\n', newText: 'is\n' },
    });
    yield* second.record({
      origin: 'write',
      path: `${ROOT}/src/a.ts`,
      at: new Date(3_000),
      hunk: { firstLine: 40, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'their old\n', newText: 'their new\n' },
    });

    const mine = yield* turnsOf(units, store, 1, 'thread-one', 20);
    expect(mine.rows.map((row) => [row.path, row.state])).toEqual([['src/a.ts', 'held']]);

    const holders = yield* evidenceOfPath(units, store, spelled('src/a.ts'));
    expect(holders.map((row) => row.threadId)).toEqual(['thread-one', 'thread-two']);
    expect(yield* addressOf(store.db, 'builder', { threadId: 'thread-one', projectId: 1 })).toEqual({
      projectId: 1,
      threadId: ThreadId.make('thread-two'),
    });
  }).pipe(Effect.provide(machineLayers)),
);

it.live('a claimed row stops being held and stays in the session history', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const log = yield* recorder(units, store, 1, ROOT, 'thread-one');
    yield* log.record({
      origin: 'edit',
      path: `${ROOT}/src/a.ts`,
      at: new Date(1_000),
      hunk: { firstLine: 1, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'one\n', newText: 'two\n' },
    });

    const before = yield* heldOfThread(units, store, 1, 'thread-one');
    expect(before).toHaveLength(1);

    yield* store.db
      .update(workspaceChange)
      .set({ state: 'committed', committedAt: new Date(9_000), commit: 'abc1234' })
      .pipe(Effect.asVoid);

    expect(yield* heldOfThread(units, store, 1, 'thread-one')).toHaveLength(0);
    expect(yield* evidenceOfPath(units, store, spelled('src/a.ts'))).toHaveLength(0);
    expect((yield* turnsOf(units, store, 1, 'thread-one', 20)).rows.map((row) => [row.state, row.commit])).toEqual([
      ['committed', 'abc1234'],
    ]);
  }).pipe(Effect.provide(machineLayers)),
);

it.live('retired typed edits stay visible to the record of their path', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const agent = {
      ownerId: 'owner',
      agentId: 'tagma',
      provider: 'openai-oauth' as const,
      model: 'gpt-test',
      reasoning: 'high' as const,
      authority: { mode: 'trust' as const, bypassFrom: null },
      status: 'idle' as const,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    for (const row of [
      { ...agent, id: 'thread-live', spawnRootId: 'thread-live', cacheGroup: 'thread-live', name: 'live' },
      { ...agent, id: 'thread-gone', spawnRootId: 'thread-gone', cacheGroup: 'thread-gone', name: 'gone' },
    ]) {
      yield* bornThread(store.db, row);
    }
    for (const place of [
      { threadId: 'thread-live', title: 'Live' },
      { threadId: 'thread-gone', title: 'Gone' },
    ] as const) {
      yield* scopeRecord(store.db, place.threadId, { projectId: 1, title: place.title, readerOrderAt: new Date(0) });
    }
    const live = yield* recorder(units, store, 1, ROOT, 'thread-live');
    const gone = yield* recorder(units, store, 1, ROOT, 'thread-gone');
    yield* gone.record({
      origin: 'edit',
      path: `${ROOT}/src/a.ts`,
      at: new Date(1_000),
      hunk: { firstLine: 1, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'one\n', newText: 'gone\n' },
    });
    yield* live.record({
      origin: 'edit',
      path: `${ROOT}/src/a.ts`,
      at: new Date(2_000),
      hunk: { firstLine: 2, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'two\n', newText: 'live\n' },
    });
    yield* shelveRecord(store.db, 'thread-gone', { archivedAt: new Date(3_000) });

    const history = yield* turnsOf(units, store, 1, 'thread-gone', 20);
    expect(history.rows.map((row) => row.state)).toEqual(['held']);
    expect(yield* heldOfThread(units, store, 1, 'thread-gone')).toHaveLength(1);
    expect((yield* evidenceOfPath(units, store, spelled('src/a.ts'))).map((row) => row.threadId)).toEqual(['thread-gone', 'thread-live']);
  }).pipe(Effect.provide(machineLayers)),
);

it.live('a neighbour editing during a read-only command leaves the reading session with no record', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const dir = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-changes-' });
    yield* gitEffect(dir, ['init', '-q']);
    yield* gitEffect(dir, ['config', 'user.email', 'a@b.c']);
    yield* gitEffect(dir, ['config', 'user.name', 'test']);
    yield* files.makeDirectory(join(dir, 'packages', 'reader'), { recursive: true });
    yield* files.makeDirectory(join(dir, 'packages', 'writer'), { recursive: true });
    yield* files.writeFileString(join(dir, 'packages', 'reader', 'source.ts'), 'const a = 3;\n');
    yield* files.writeFileString(join(dir, 'packages', 'writer', 'alpha.ts'), 'const a = 1;\n');
    yield* gitEffect(dir, ['add', 'packages']);
    yield* gitEffect(dir, ['commit', '-qm', 'first']);

    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: dir, rootPath: dir, createdAt: new Date(0) });

    const reader = createTools({
      cwd: dir,
      world: makeMachineWorld(() => null),
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
      changes: (yield* recorder(units, store, 1, dir, 'thread-reader')).port,
    });
    const writer = createTools({
      cwd: dir,
      world: makeMachineWorld(() => null),
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
      changes: (yield* recorder(units, store, 1, dir, 'thread-writer')).port,
    });

    yield* call(reader.bash, { command: 'true', workdir: 'packages/reader', description: 'Start the catalog' });
    yield* call(writer.edit, {
      path: 'packages/writer/alpha.ts',
      oldString: 'const a = 1;',
      newString: 'const a = 2;',
    });
    expect(
      yield* call(reader.bash, {
        command: 'cat ../writer/alpha.ts',
        workdir: 'packages/reader',
        description: 'Read another package file',
      }),
    ).toContain('const a = 2;');

    expect((yield* turnsOf(units, store, 1, 'thread-reader', 20)).rows).toEqual([]);
    const held = yield* heldOfThread(units, store, 1, 'thread-writer');
    expect(held.map((row) => `${row.origin} ${row.path}`)).toEqual(['edit packages/writer/alpha.ts']);
    const holders = yield* evidenceOfPath(units, store, spelled('packages/writer/alpha.ts'));
    expect(holders.map((row) => row.threadId)).toEqual(['thread-writer']);
  }).pipe(Effect.provide(machineLayers)),
);

const call = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const execute = toolExecute(tool);
  if (!execute) return yield* Effect.die('The tool declares no execute.');
  const prepare = toolPrepare(tool);
  const resolved = prepare ? yield* prepare(input, { toolCallId: 'call-1', caller: unthreadedCaller }) : undefined;
  const settled = yield* execute(input, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [], prepared: resolved?.prepared });
  return String(settled instanceof ToolAnswer ? settled.value : settled);
});

it.live('a record against a project that does not exist is refused and records nothing', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const orphan = yield* recorder(units, store, 404, ROOT, 'thread-one');
    const refused = yield* Effect.flip(orphan.record({ origin: 'edit', path: `${ROOT}/src/a.ts`, at: new Date(1_000) }));
    expect(refused._tag).toBe('IntakeRefused');
    expect((yield* turnsOf(units, store, 1, 'thread-one', 20)).rows).toHaveLength(0);
  }).pipe(Effect.provide(machineLayers)),
);

const downStore = <Brand extends StoreBrand>(store: Store<Brand>): Store<Brand> => {
  const down: Effect.Effect<never, EffectDrizzleQueryError> = Effect.fail(
    new EffectDrizzleQueryError({ query: 'select', params: [], cause: new Error('the store is down') }),
  );
  const stub: unknown = new Proxy(down, {
    get: (target, property, receiver) => {
      if (property in target) return Reflect.get(target, property, receiver);
      return () => stub;
    },
  });
  return {
    ...store,
    db: new Proxy(store.db, {
      get: () => () => stub,
    }),
  } as Store<Brand>;
};

it.live('a store failure fails every read instead of answering empty', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const down = downStore(store);
    const failed = <A, E>(self: Effect.Effect<A, E>) => Effect.flip(self);

    expect((yield* failed(turnsOf(units, down, 1, 'thread-one', 20)))._tag).toBe('EffectDrizzleQueryError');
    expect((yield* failed(evidenceOfPath(units, down, spelled('src/a.ts'))))._tag).toBe('EffectDrizzleQueryError');
    expect((yield* failed(heldOfThread(units, down, 1, 'thread-one')))._tag).toBe('EffectDrizzleQueryError');
    expect((yield* failed(addressOf(down.db, 'builder', { threadId: 'thread-one', projectId: 1 })))._tag).toBe('EffectDrizzleQueryError');
  }).pipe(Effect.provide(machineLayers)),
);

it.live('a store failure resolving an address fails instead of answering no-agent', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const failure = yield* Effect.flip(addressOf(downStore(store).db, 'builder', { threadId: 'thread-one', projectId: 1 }));
    expect(failure._tag).toBe('EffectDrizzleQueryError');
    const handover = yield* Effect.flip(resolveHandover(downStore(store), 1, 'thread-one', ['builder']));
    expect(handover._tag).toBe('EffectDrizzleQueryError');
  }).pipe(Effect.provide(machineLayers)),
);

it.live('a landing reads ordered references from its own checkout while path evidence resolves its texts', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const row = (threadId: string, checkout: string, path: string, at: number) => ({
      projectId: 1,
      holderProjectId: 1,
      holder: threadId,
      runId: null,
      checkout,
      path,
      state: 'held' as const,
      origin: 'edit' as const,
      beforeHash: `before-${threadId}-${path}`,
      afterHash: `after-${threadId}-${path}`,
      at: new Date(at),
    });
    const inserted = yield* store.db
      .insert(workspaceChange)
      .values([
        row('thread-one', CHECKOUT, 'src/a.ts', 1_000),
        row('thread-two', CHECKOUT, 'src/a.ts', 2_000),
        row('thread-elsewhere', 'other-checkout', 'src/a.ts', 3_000),
        row('thread-one', CHECKOUT, 'src/b.ts', 5_000),
      ])
      .returning({ id: workspaceChange.id });
    yield* store.db.insert(workspaceChangeText).values(inserted.map(({ id }) => ({ row: id, oldText: 'old', newText: 'new' })));
    yield* store.db.insert(workspaceChangeContent).values([
      { digest: 'before-thread-one-src/a.ts', text: 'a before\n', bytes: 9 },
      { digest: 'after-thread-one-src/b.ts', text: 'b after\n', bytes: 8 },
    ]);

    const places = [spelled('src/a.ts'), spelled('src/b.ts'), spelled('src/c.ts')];
    const read = new Map(yield* evidenceInGroups(units, store, places, (evidence) => Effect.succeed([...evidence])));

    expect(read.get('src/a.ts')?.map((one) => one.threadId)).toEqual(['thread-one', 'thread-two']);
    const a = yield* evidenceOfPath(units, store, spelled('src/a.ts'));
    const b = yield* evidenceOfPath(units, store, spelled('src/b.ts'));
    expect(a[0]?.beforeContent).toEqual({ _tag: 'text', text: 'a before\n' });
    expect(a[1]?.beforeContent).toEqual({ _tag: 'unavailable' });
    expect(b[0]?.afterContent).toEqual({ _tag: 'text', text: 'b after\n' });
    expect(read.get('src/c.ts')).toEqual([]);
    for (const place of places) {
      const full = yield* evidenceOfPath(units, store, place);
      expect(
        full.map(({ id, path, threadId, beforeHash, afterHash, unresolved }) => ({
          id,
          path,
          threadId,
          beforeHash,
          afterHash,
          unresolved,
        })),
      ).toEqual([...(read.get(place.path) ?? [])]);
    }
  }).pipe(Effect.provide(machineLayers)),
);

it.live('a withdrawn row is held by nobody and stays in the session’s history', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const row = (id: string, path: string, at: number) => ({
      id,
      projectId: 1,
      holderProjectId: 1,
      holder: 'thread-one',
      runId: null,
      checkout: CHECKOUT,
      path,
      state: 'held' as const,
      origin: 'write' as const,
      afterHash: 'seeded',
      at: new Date(at),
    });
    yield* store.db.insert(workspaceChange).values([row('kept', 'src/a.ts', 1_000), row('vanished', 'src/gone.ts', 2_000)]);

    const retiring = yield* retireStoreOf(store, units);
    const withdraw = retiring.leave([{ id: 'vanished', state: 'withdrawn', reason: 'reverted', span: null }], false);
    expect((yield* withdraw).map((left) => left.id)).toEqual(['vanished']);
    expect(yield* withdraw).toEqual([]);

    expect((yield* heldOfThread(units, store, 1, 'thread-one')).map((held) => held.path)).toEqual(['src/a.ts']);
    expect(yield* evidenceOfPath(units, store, spelled('src/gone.ts'))).toEqual([]);
    expect((yield* turnsOf(units, store, 1, 'thread-one', 20)).rows.map((turn) => [turn.path, turn.state, turn.reason])).toEqual([
      ['src/gone.ts', 'withdrawn', 'reverted'],
      ['src/a.ts', 'held', null],
    ]);
  }).pipe(Effect.provide(machineLayers)),
);

const unacknowledged = (units: MachineUnits['Service']): MachineUnits['Service'] => ({
  read: (work) => units.read(work),
  markReadOnly: (effect) => units.markReadOnly(effect),
  markWrite: (effect) => units.markWrite(effect),
  write: (operation, work) =>
    units
      .write(operation, work)
      .pipe(
        Effect.flatMap(() =>
          Effect.fail(new EffectDrizzleQueryError({ query: 'commit', params: [], cause: new Error('the reply was lost') })),
        ),
      ),
});

it.live('a write whose commit was never acknowledged is refused, and the row the store kept stands once', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const lost = yield* recorder(unacknowledged(units), store, 1, ROOT, 'thread-one');
    const refused = yield* Effect.flip(
      lost.record({
        origin: 'edit',
        path: `${ROOT}/src/a.ts`,
        at: new Date(1_000),
        before: 'was',
        after: 'is',
        hunk: { firstLine: 1, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'was\n', newText: 'is\n' },
      }),
    );
    expect(refused._tag).toBe('IntakeRefused');
    expect((yield* turnsOf(units, store, 1, 'thread-one', 20)).rows.map((row) => row.path)).toEqual(['src/a.ts']);

    const healthy = yield* recorder(units, store, 1, ROOT, 'thread-one');
    expect(yield* healthy.record({ origin: 'edit', path: `${ROOT}/src/b.ts`, at: new Date(2_000) })).toBe(true);
    expect((yield* turnsOf(units, store, 1, 'thread-one', 20)).rows.map((row) => row.path)).toEqual(['src/b.ts', 'src/a.ts']);
  }).pipe(Effect.provide(machineLayers)),
);

it.live('the turns of a session walk by position, ties included, and count what they walk', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
    const port = yield* recorder(units, store, 1, ROOT, 'thread-one');
    for (let at = 0; at < 7; at += 1) {
      yield* port.record({
        origin: 'edit',
        path: `${ROOT}/src/f${at}.ts`,
        at: new Date(1_000 * (1 + (at % 3))),
        hunk: { firstLine: 1, oldLines: 1, newLines: 1, windowBefore: 0, oldText: `old ${at}\n`, newText: `new ${at}\n` },
      });
    }

    const walked: string[] = [];
    let after: { at: number; key: string } | undefined;
    for (;;) {
      const { rows } = yield* turnsOf(units, store, 1, 'thread-one', 3, after);
      if (rows.length === 0) break;
      walked.push(...rows.map((row) => row.path));
      const last = rows[rows.length - 1]!;
      after = { at: last.at, key: last.key };
    }
    const whole = yield* turnsOf(units, store, 1, 'thread-one', 100);
    expect(whole.total).toBe(7);
    expect(walked).toEqual(whole.rows.map((row) => row.path));
    expect(new Set(walked).size).toBe(7);
  }).pipe(Effect.provide(machineLayers)),
);

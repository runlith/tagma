import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { lstatSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { eq, getTableColumns } from 'drizzle-orm';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { callerInThread } from '../callers.js';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { Git } from '@runlith/git/Git';
import { bornThread } from '../../../native-harness/testing/born.js';
import { changeRecordOf, intakeOf } from '../../../change-record/testing/doubles.js';
import { workspaceChange, workspaceChangeText } from '../../../change-record/store/tables.js';
import { checkoutPaths, fixedCoverage } from '../../../workspace/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

const THREAD = 'symlink-writer';

const called = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const call = { toolCallId: crypto.randomUUID(), caller: callerInThread(THREAD, 'run') };
  const prepare = toolPrepare(tool);
  const prepared = prepare === null ? null : (yield* prepare(input, call)).prepared;
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('the tool has no execution');
  return yield* execute(input, { ...call, prepared, messages: [] });
});

layer(demoGraphLayer({ repos: ['home', 'target'] }), { excludeTestServices: true })('symlink intake', (it) => {
  it.effect('write and edit through a link own the target’s rows, while deleting the link owns its directory entry', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const liveGit = yield* Git;
        const home = demo.project('home');
        const target = demo.project('target');
        const homeRoot = realpathSync(home.root);
        const targetRoot = realpathSync(target.root);
        const homeCoverage = fixedCoverage(home.id, [{ checkout: 'home', root: homeRoot }]);
        const targetCoverage = fixedCoverage(target.id, [{ checkout: 'target', root: targetRoot }]);
        const demoCoverage = fixedCoverage(demo.projectId, [{ checkout: 'demo', root: demo.demoRoot }]);
        const paths = yield* checkoutPaths(
          {
            ...homeCoverage,
            covered: (id) => (id === target.id ? targetCoverage : id === home.id ? homeCoverage : demoCoverage).covered(id),
          },
          demo.graph.projects,
        ).pipe(Effect.provide(demo.context));
        const { store, units } = demo.graph;
        yield* bornThread(
          store.db,
          {
            id: THREAD,
            ownerId: 'owner',
            agentId: 'tagma',
            spawnRootId: THREAD,
            cacheGroup: THREAD,
            status: 'idle',
            provider: 'openai-oauth',
            model: 'gpt-test',
            reasoning: 'high',
            authority: { mode: 'trust', bypassFrom: null },
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
          { projectId: home.id, title: 'Writer', readerOrderAt: new Date(0) },
        ).pipe(Effect.provide(demo.context));
        const intake = yield* intakeOf(store, units, liveGit, paths);
        const record = yield* changeRecordOf(store, units, paths, intake);
        const tools = createTools({
          cwd: homeRoot,
          allowOutsideCwd: true,
          world: makeMachineWorld(() => null),
          changes: record.changes({ work: { projectId: home.id, threadId: THREAD } }),
          commandTimes: unruledTimes,
          searchMs: LONGEST_ACT_MS,
        });
        const file = join(targetRoot, 'shared.ts');
        const link = join(homeRoot, 'linked.ts');
        writeFileSync(file, 'const a = 1;\n');
        symlinkSync(file, link);
        expect((yield* paths.placeAcross(link))?.projectId).toBe(home.id);
        expect((yield* paths.resourceAcross(link))?.projectId).toBe(target.id);

        yield* called(tools.write as Tool, { path: 'linked.ts', content: 'const a = 2;\n' });
        yield* called(tools.edit as Tool, { path: 'linked.ts', oldString: 'a = 2', newString: 'a = 3' });
        expect(readFileSync(file, 'utf8')).toBe('const a = 3;\n');
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        const written = yield* store.db.select().from(workspaceChange);
        expect(written.map((row) => [row.projectId, row.holderProjectId, row.checkout, row.path, row.mode, row.state])).toEqual([
          [target.id, home.id, 'target', 'shared.ts', '100644', 'held'],
          [target.id, home.id, 'target', 'shared.ts', '100644', 'held'],
        ]);

        const redirected = join(targetRoot, 'redirected.ts');
        writeFileSync(redirected, 'const untouched = true;\n');
        const call = { toolCallId: crypto.randomUUID(), caller: callerInThread(THREAD, 'run') };
        const write = tools.write as Tool;
        const input = { path: 'linked.ts', content: 'const a = 4;\n' };
        const prepared = (yield* toolPrepare(write)!(input, call)).prepared;
        unlinkSync(link);
        symlinkSync(redirected, link);
        yield* toolExecute(write)!(input, { ...call, prepared, messages: [] });
        expect(readFileSync(file, 'utf8')).toBe('const a = 4;\n');
        expect(readFileSync(redirected, 'utf8')).toBe('const untouched = true;\n');
        const rebound = yield* store.db.select().from(workspaceChange);
        expect(rebound.every((row) => row.path === 'shared.ts' && row.checkout === 'target')).toBe(true);

        yield* called(tools.delete as Tool, { args: ['linked.ts'], glob: false });
        expect(readFileSync(file, 'utf8')).toBe('const a = 4;\n');
        const removed = (yield* store.db.select().from(workspaceChange)).find((row) => row.origin === 'delete');
        expect([removed?.projectId, removed?.holderProjectId, removed?.checkout, removed?.path]).toEqual([
          home.id,
          home.id,
          'home',
          'linked.ts',
        ]);

        const scratch = yield* files.makeTempDirectoryScoped({ prefix: 'delete-scratch-' });
        const path = join(scratch, 'tagma.sqlite');
        yield* files.writeFileString(path, 'SQLite format 3\0');
        yield* files.truncate(path, 24 * 1024 ** 3);
        const deleting = tools.delete as Tool;
        yield* called(deleting, { args: [path], glob: false });
        expect(yield* files.exists(path)).toBe(false);
        expect((yield* store.db.select().from(workspaceChange)).map((row) => row.id)).toEqual(
          rebound.map((row) => row.id).concat(removed!.id),
        );

        yield* called(tools.delete as Tool, { args: [file], glob: false });
        const deletion = (yield* store.db
          .select({ ...getTableColumns(workspaceChange), oldText: workspaceChangeText.oldText })
          .from(workspaceChange)
          .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange.id))).find(
          (row) => row.path === 'shared.ts' && row.origin === 'delete',
        );
        expect(deletion).toMatchObject({
          projectId: target.id,
          holderProjectId: home.id,
          checkout: 'target',
          beforeHash: expect.any(String),
          oldText: 'const a = 4;\n',
          oldLines: 1,
          state: 'held',
        });
        expect(readFileSync(redirected, 'utf8')).toBe('const untouched = true;\n');
      }).pipe(Effect.provide(BunFileSystem.layer)),
    ),
  );
});

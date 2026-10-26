import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { createDeleteTool } from '@runlith/agent-tools/delete';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { ToolAnswer, toolPrepare, toolExecute } from '@runlith/agent/tool';
import { callerInThread } from '../callers.js';
import { settleIntents } from '../../../change-record/record/intents.js';
import { ByteSize, Clock, Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { workspaceChange } from '../../../change-record/store/tables.js';
import { recordWrite, servedOver } from '../../../change-record/testing/doubles.js';
import { fixedCheckoutPaths, fixedCoverage } from '../../../workspace/testing/doubles.js';
import { BORN, GROWN, MINE, PROJECT, edited, fixture, layers, run } from './threadFilesWorld.js';

layer(layers, { excludeTestServices: true })('Git metadata in the change record', (it) => {
  it.effect('recursive checkout deletion retains HEAD and normalization before their Git metadata disappears', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const head = (yield* run(world.git, world.root, ['rev-parse', 'HEAD'])).trim();
      yield* world.files.writeFileString(world.paths.join(world.root, '.gitattributes'), 'kept.txt text eol=crlf\n');
      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), BORN.replace(/\n/g, '\r\n'));
      const tool = createDeleteTool({
        cwd: world.root,
        world: machineWorld,
        changes: world.mine,
        commandTimes: unruledTimes,
        searchMs: 1000,
      });
      const call = { toolCallId: 'delete-checkout', caller: callerInThread(MINE, 'run') };
      const input = { args: ['-r', '--', world.root], glob: false };
      const prepared = (yield* toolPrepare(tool)!(input, call)).prepared;
      const result = yield* toolExecute(tool)!(input, { ...call, prepared, messages: [] });
      expect(result instanceof ToolAnswer && result.verdict).toEqual({ kind: 'answered' });
      expect(yield* world.files.exists(world.root)).toBe(false);
      const rows = yield* world.store.db
        .select({ path: workspaceChange.path, head: workspaceChange.head, holder: workspaceChange.holder })
        .from(workspaceChange);
      expect(rows).toEqual([
        { path: 'kept.txt', head, holder: MINE },
        { path: '.gitattributes', head, holder: MINE },
      ]);
      tool.settled?.(call);
    }),
  );

  it.effect('recursive deletion of a checkout keeps HEAD on its rows when its Git directory stands beside them', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const head = (yield* run(world.git, world.root, ['rev-parse', 'HEAD'])).trim();
      yield* run(world.git, world.root, ['init', '-q', '--separate-git-dir=.control']);
      const names = ['a.txt', 'm.txt', 'z.txt'];
      for (const name of names) yield* world.files.writeFileString(world.paths.join(world.root, name), BORN);
      const tool = createDeleteTool({
        cwd: world.root,
        world: machineWorld,
        changes: world.mine,
        commandTimes: unruledTimes,
        searchMs: 1000,
      });
      const call = { toolCallId: 'delete-separate', caller: callerInThread(MINE, 'run') };
      const input = { args: ['-r', '--', world.root], glob: false };
      const prepared = (yield* toolPrepare(tool)!(input, call)).prepared;
      yield* toolExecute(tool)!(input, { ...call, prepared, messages: [] });
      expect(yield* world.files.exists(world.root)).toBe(false);
      const rows = yield* world.store.db.select({ path: workspaceChange.path, head: workspaceChange.head }).from(workspaceChange);
      expect(rows.map((row) => row.path).sort()).toEqual(['a.txt', 'kept.txt', 'm.txt', 'z.txt']);
      expect(rows.map((row) => row.head)).toEqual(rows.map(() => head));
      tool.settled?.(call);
    }),
  );

  it.effect('Git metadata writes stay outside the change record and Changes for a checkout and its worktree', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const beside = world.paths.join(world.root, '..', 'beside');
      yield* run(world.git, world.root, ['worktree', 'add', '-q', '-b', 'beside', beside]);
      const directory = yield* run(world.git, beside, ['rev-parse', '--absolute-git-dir']);
      for (const path of [world.paths.join(world.root, '.git', 'agent.txt'), world.paths.join(directory, 'agent.txt')]) {
        const landed = yield* world.mine.land(
          [{ origin: 'write', path, at: new Date(yield* Clock.currentTimeMillis), after: contentDigest(GROWN), afterText: GROWN }],
          world.files.writeFileString(path, GROWN).pipe(Effect.as(true)),
        );
        expect(landed).toEqual({ _tag: 'written', kept: false });
        expect(yield* world.files.readFileString(path)).toBe(GROWN);
        expect(
          yield* world.intake.report({ projectId: PROJECT, holder: { kind: 'thread', thread: MINE } }, [
            { origin: 'write', path, at: new Date(yield* Clock.currentTimeMillis), after: contentDigest(GROWN), afterText: GROWN },
          ]),
        ).toEqual([]);
      }
      expect((yield* world.list()).held).toEqual({ paths: 0, unproven: 0 });
      expect((yield* world.list()).checkouts.flatMap((checkout) => checkout.entries)).toEqual([]);
      expect([...(yield* world.holdings.judged(world.rootId, ['.git/agent.txt', '.git/worktrees/beside/agent.txt'])).keys()]).toEqual([]);

      const common = world.paths.join(world.root, '.shared');
      yield* world.files.copy(world.paths.join(world.root, '.git'), common);
      yield* world.files.writeFileString(world.paths.join(world.root, '.git', 'commondir'), `${common}\n`);
      const shared = world.paths.join(common, 'agent.txt');
      expect(
        yield* world.mine.land(
          [{ origin: 'write', path: shared, at: new Date(yield* Clock.currentTimeMillis), after: contentDigest(GROWN), afterText: GROWN }],
          world.files.writeFileString(shared, GROWN).pipe(Effect.as(true)),
        ),
      ).toEqual({ _tag: 'written', kept: false });
      expect([...(yield* world.holdings.judged(world.rootId, ['.shared/agent.txt'])).keys()]).toEqual([]);

      yield* run(world.git, world.root, ['init', '-q', '--separate-git-dir=.control']);
      const path = world.paths.join(world.root, '.control', 'agent.txt');
      const landed = yield* world.mine.land(
        [{ origin: 'write', path, at: new Date(yield* Clock.currentTimeMillis), after: contentDigest(GROWN), afterText: GROWN }],
        world.files.writeFileString(path, GROWN).pipe(Effect.as(true)),
      );
      expect(landed).toEqual({ _tag: 'written', kept: false });
      expect([...(yield* world.holdings.judged(world.rootId, ['.control/agent.txt'])).keys()]).toEqual([]);
      expect((yield* world.list()).held).toEqual({ paths: 0, unproven: 0 });
    }),
  );

  it.effect('entry deletion keeps unmeasured provenance unknown and recovers existing and absent intents without reading bytes', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const file = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFile(file, new Uint8Array([0, 65]));
      const tool = createDeleteTool({
        cwd: world.root,
        world: machineWorld,
        changes: world.mine,
        commandTimes: unruledTimes,
        searchMs: 1000,
      });
      const call = { toolCallId: 'delete', caller: callerInThread(MINE, 'run') };
      const input = { args: [file], glob: false };
      const prepared = (yield* toolPrepare(tool)!(input, call)).prepared;
      yield* toolExecute(tool)!(input, { ...call, prepared, messages: [] });
      const judged = yield* world.holdings.judged(world.rootId, ['kept.txt']);
      expect(judged.get('kept.txt')?.holding.verdict).toMatchObject({
        verdict: 'unknown',
        reason: { kind: 'opaque' },
        writers: [{ kind: 'thread', thread: MINE }],
      });

      const path = world.paths.join(world.root, 'large.sqlite');
      yield* world.files.writeFileString(path, 'SQLite format 3\0');
      yield* world.files.truncate(path, 24 * 1024 ** 3);
      yield* world.store.db.insert(workspaceChange).values([
        {
          id: 'present-delete',
          projectId: PROJECT,
          holderProjectId: PROJECT,
          holder: MINE,
          checkout: world.rootId,
          path: 'large.sqlite',
          state: 'writing',
          origin: 'delete',
        },
        {
          id: 'absent-delete',
          projectId: PROJECT,
          holderProjectId: PROJECT,
          holder: MINE,
          checkout: world.rootId,
          path: 'absent.sqlite',
          state: 'writing',
          origin: 'delete',
        },
      ]);
      expect(yield* settleIntents(world.units, world.store, world.roots, world.walks)).toEqual({ confirmed: 1, withdrawn: 1, unread: 0 });
      const rows = yield* world.store.db.select({ id: workspaceChange.id, state: workspaceChange.state }).from(workspaceChange);
      expect(rows.filter((row) => row.id.endsWith('-delete'))).toEqual([{ id: 'absent-delete', state: 'held' }]);
      expect((yield* world.files.stat(path)).size).toBe(ByteSize.bytes(24 * 1024 ** 3));
    }),
  );

  it.effect('a delete intent whose file now stands only under another spelling of its name is confirmed', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* world.files.writeFileString(world.paths.join(world.root, 'Renamed.txt'), BORN);
      yield* world.store.db.insert(workspaceChange).values({
        id: 'renamed-delete',
        projectId: PROJECT,
        holderProjectId: PROJECT,
        holder: MINE,
        checkout: world.rootId,
        path: 'renamed.txt',
        state: 'writing',
        origin: 'delete',
      });

      expect(yield* settleIntents(world.units, world.store, world.roots, world.walks)).toEqual({ confirmed: 1, withdrawn: 0, unread: 0 });
    }),
  );

  it.effect('serving retires recorded Git metadata while preserving a thread’s working-tree edit', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const path = world.paths.join(world.root, '.git', 'agent.txt');
      yield* world.files.writeFileString(path, GROWN);
      yield* recordWrite(
        world.units,
        world.store,
        PROJECT,
        MINE,
        { checkout: world.rootId, path: '.git/agent.txt' },
        {
          before: BORN,
          after: GROWN,
          mode: '100644',
        },
      );
      const common = world.paths.join(world.root, '.control');
      yield* world.files.copy(world.paths.join(world.root, '.git'), common);
      yield* world.files.writeFileString(world.paths.join(world.root, '.git', 'commondir'), `${common}\n`);
      yield* recordWrite(
        world.units,
        world.store,
        PROJECT,
        MINE,
        { checkout: world.rootId, path: '.control/agent.txt' },
        { before: BORN, after: GROWN, mode: '100644' },
      );
      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      const checkouts = [{ checkout: world.rootId, root: world.root }];
      const served = yield* servedOver({
        store: world.store,
        units: world.units,
        git: world.git,
        checkouts: world.checkouts,
        paths: yield* fixedCheckoutPaths(PROJECT, checkouts),
        roots: world.roots,
        coverage: fixedCoverage(PROJECT, checkouts),
      });
      yield* served.judges.settled(world.rootId);
      expect((yield* served.judges.read(world.rootId)).paths.map((holding) => holding.path)).toEqual(['kept.txt']);
      expect((yield* served.judges.threads([MINE])).get(MINE)?.paths).toBe(1);
      expect((yield* served.changes.turns({ projectId: PROJECT, threadId: MINE, limit: 10 })).rows.map((row) => row.path)).toEqual([
        'kept.txt',
      ]);
      expect((yield* world.store.db.select({ path: workspaceChange.path }).from(workspaceChange)).map((row) => row.path)).toEqual([
        'kept.txt',
      ]);
      expect(yield* world.files.readFileString(world.paths.join(world.root, '.control', 'agent.txt'))).toBe(GROWN);
    }),
  );
});

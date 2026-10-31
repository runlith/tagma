import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { makeThreadDoors, type Outcome } from '../threadDoors.js';
import { suiteGit, suiteGitText } from '../suiteGit.js';
import { makeDoorWorld, projectLeaving, WORLD_SOURCE } from '../doorFixture.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';

const REEXPORTS = { builtin: 'reexports', params: { base: '', allows: [], files: { extensions: ['.ts'], exclude: [] } } };

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({ own: "it registers the world's source checkout as a team project" });
  const files = yield* FileSystem.FileSystem;
  yield* suiteGit(world.sourceCheckout, 'init', '-q', '-b', 'main');
  yield* files.writeFileString(
    join(world.sourceCheckout, 'tagma.config.ts'),
    `export default ${JSON.stringify({ inspections: { reexports: REEXPORTS } })};\n`,
  );
  yield* files.writeFileString(join(world.sourceCheckout, 'server', 'fix'), 'before');
  yield* files.writeFileString(join(world.sourceCheckout, 'server', 'value.ts'), 'export const value = 1;\n');
  yield* suiteGit(world.sourceCheckout, 'add', '-A');
  yield* suiteGit(world.sourceCheckout, 'commit', '-qm', 'seed');
  const added = yield* world.op('add_project', { name: 'source', rootPath: world.sourceCheckout, storage: 'team' });
  expect(added.status).toBe(200);
  const project = (added.body as { project: { id: number } }).project.id;
  yield* projectLeaving(world, project);
  expect((yield* world.op('write_setting', { project, key: 'graph.commit', value: 'manual' }, `project=${project}`)).status).toBe(200);
  const parent = ((yield* world.op('list_root_blocks', {}, `project=${project}`)).body as { blocks: { name: string }[] }).blocks[0]!.name;
  const module = yield* world.op(
    'set_module',
    { modules: [{ id: 'server', title: 'The server', parent, root: 'server' }] },
    `project=${project}`,
  );
  expect(module.status).toBe(200);
  return { world, project, parent, area: (module.body as { modules: { card: string }[] }).modules[0]!.card };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ReflectWorktree') {}

const op = (id: string, input: unknown) => Effect.flatMap(Place, ({ world, project }) => world.op(id, input, `project=${project}`));
const read = Effect.fnUntraced(function* (name: string, cwd?: string) {
  const { world, project } = yield* Place;
  const response = yield* world.op(
    'read_block',
    { blockIds: [name] },
    `project=${project}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`,
  );
  expect(response.status).toBe(200);
  return (response.body as { reads: Record<string, unknown>[] }).reads[0] as Record<string, unknown>;
});
const answered = (outcome: Outcome) =>
  outcome.class === 'refusal'
    ? Effect.die(new Error(`${outcome.code}: ${outcome.unblock.join('; ')}`))
    : Effect.succeed(outcome.value as Record<string, unknown>);

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('reflections from a worktree', (it) => {
  it.effect('a native filing chooses stealth at birth without publishing a team version, while an omitted choice inherits team', () =>
    Effect.gen(function* () {
      const { world, project, area } = yield* Place;
      const born = yield* op('create_thread', { approvalMode: 'bypass' });
      expect(born.status).toBe(200);
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      const doors = makeThreadDoors(world, project, ['file_reflection']);
      const placed = yield* doors.doorsFor(thread.id, thread.ownerId);
      const filing = {
        title: 'private-filing-birth-marker',
        command: 'read_block returned another block',
        expected: 'the named block',
        actual: 'a different block',
      };
      const filed = yield* answered(yield* doors.atNative('file_reflection', { ...filing, storage: 'stealth' }, placed));
      const name = (filed.block as { name: string }).name;
      expect(yield* read(name)).toMatchObject({ parentName: area, stealth: true });
      const events = yield* op('read_events', { blockId: name, limit: 2 });
      expect(events).toMatchObject({ status: 200, body: { events: [{ op: 'create' }], complete: true } });
      expect((yield* op('sync_graph', {})).status).toBe(200);
      expect(yield* suiteGitText(world.sourceCheckout, 'log', '--all', '--format=%H', '-S', filing.title, '--', '.tagma')).toBe('');
      const inherited = yield* answered(yield* doors.atNative('file_reflection', { ...filing, title: 'an ordinary team filing' }, placed));
      const teamName = (inherited.block as { name: string }).name;
      expect((yield* read(teamName)).stealth).toBeUndefined();
    }),
  );

  it.effect('thread credentials keep rules local and file, read and answer reflections in main at both doors', () =>
    Effect.gen(function* () {
      const { world, project, area, parent } = yield* Place;
      const files = yield* FileSystem.FileSystem;
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const main = yield* world.runtime.pool.resolve({ projectId: project });
      const mainCheckout = yield* files.realPath(world.sourceCheckout);
      const repositories = (yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer;
      const repository = repositories.repositories[0]?.binding;
      if (repository === undefined) return yield* Effect.die(new Error('the source project covers no repository'));
      const approvedValue = yield* suiteGitText(world.sourceCheckout, 'show', 'HEAD:server/value.ts');
      yield* files.writeFileString(join(world.sourceCheckout, 'server', 'value.ts'), 'export const value = 2;\n');
      const ruleCreated = yield* op('create_block', { tags: ['rule'], title: 'One branch enforces this rule', parentId: parent });
      const rule = (ruleCreated.body as { block: { name: string } }).block.name;
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'reflection');
      expect(
        (yield* op('prepare_worktree', {
          operationId: 'reflection',
          repository,
          destination,
          mode: { kind: 'new-branch', branch: 'reflection', start: 'HEAD' },
        })).status,
      ).toBe(200);
      const inherited = yield* op('create_block', {
        tags: ['task'],
        title: 'A task written after preparing the worktree',
        parentId: parent,
      });
      const inheritedTask = (inherited.body as { block: { name: string } }).block.name;
      yield* world.runtime.pool.releaseProject(project);
      const created = yield* op('create_worktree', { operationId: 'reflection' });
      expect(created.status).toBe(200);
      expect(yield* read(inheritedTask, destination)).toMatchObject({ fields: { status: 'open' } });
      const mainHead = yield* suiteGit(world.sourceCheckout, 'rev-parse', 'HEAD');
      expect((created.body as { operation: { base: string } }).operation.base).toBe(mainHead);
      expect(yield* suiteGit(destination, 'status', '--porcelain', '--', '.tagma')).toBe('');
      expect(yield* files.readFileString(join(world.sourceCheckout, 'server', 'value.ts'))).toBe('export const value = 2;\n');
      expect(yield* files.readFileString(join(destination, 'server', 'value.ts'))).toBe(approvedValue);
      const rootId = (created.body as { operation: { rootId: string } }).operation.rootId;
      const born = yield* op('create_thread', { approvalMode: 'bypass' });
      expect(born.status).toBe(200);
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      expect((yield* op('move_thread', { threadId: thread.id, worktree: rootId })).status).toBe(200);
      const doors = makeThreadDoors(world, project, [
        'file_reflection',
        'read_reflections',
        'answer_reflection',
        'unanswer_reflection',
        'create_block',
      ]);
      const placed = yield* doors.doorsFor(thread.id, thread.ownerId);
      expect(placed.root).toBe(destination);
      const asThread = (id: string, input: unknown, aim = '') =>
        world.op(id, input, `project=${project}${aim}`, { [GRANT_HEADER]: placed.grant });
      expect(yield* asThread('read_block', { blockIds: [inheritedTask] })).toMatchObject({
        status: 200,
        body: { reads: [{ name: inheritedTask, fields: { status: 'open' } }] },
      });
      expect((yield* asThread('claim_block', { blockId: inheritedTask })).status).toBe(200);
      expect(yield* read(inheritedTask, destination)).toMatchObject({ fields: { status: 'in_work' } });
      expect(yield* read(inheritedTask)).toMatchObject({ fields: { status: 'open' } });
      const enforced = yield* asThread('enforce_rule', {
        blockId: rule,
        checkout: destination,
        base: null,
        strictness: 'gate',
        inspection: 'reexports',
        on: [{ op: 'submit_work', phase: 'before' }],
      });
      expect(enforced).toMatchObject({ status: 200, body: { graph: placed.served.layout.treeRoot } });
      expect((yield* read(rule, destination)).fields).toMatchObject({ enforcement: { strictness: 'gate' } });
      expect((yield* read(rule)).fields).toEqual({});
      const updated = yield* asThread('update_block', { blockId: rule, title: 'The worktree law' });
      expect(updated).toMatchObject({
        status: 200,
        body: { graphCopy: { projectId: project, checkout: destination, tree: placed.served.layout.treeRoot } },
      });
      expect((yield* read(rule)).title).toBe('One branch enforces this rule');
      expect((yield* read(rule, destination)).title).toBe('The worktree law');
      expect(
        yield* asThread('update_block', { blockId: rule, title: 'Explicit main law' }, `&cwd=${encodeURIComponent(world.sourceCheckout)}`),
      ).toMatchObject({ status: 200, body: { graphCopy: { checkout: mainCheckout, tree: main.layout.treeRoot } } });
      expect(yield* asThread('update_block', { blockId: rule, title: 'Main selected by branch' }, '&branch=main')).toMatchObject({
        status: 200,
        body: { graphCopy: { checkout: mainCheckout, tree: main.layout.treeRoot } },
      });
      expect((yield* read(rule)).title).toBe('Main selected by branch');
      expect((yield* read(rule, destination)).title).toBe('The worktree law');
      const mainParent = yield* op('create_block', { parentId: parent, title: 'Only main holds this parent' });
      const mainParentName = (mainParent.body as { block: { name: string } }).block.name;
      const freshMain = yield* world.runtime.pool.resolve({ projectId: project });
      const foreignParentId = yield* Context.get(freshMain.context, BlockNames).idOfName(mainParentName);
      const branchBlocks = Context.get(placed.served.context, Blocks);
      while ((yield* branchBlocks.liveBlock(foreignParentId)) === undefined) {
        const decoy = yield* asThread('create_block', { parentId: parent, title: 'The branch number names another parent' });
        expect(decoy.status).toBe(200);
        const decoyId = yield* Context.get(placed.served.context, BlockNames).idOfName(
          (decoy.body as { block: { name: string } }).block.name,
        );
        expect(decoyId).toBeLessThanOrEqual(foreignParentId);
      }
      const child = yield* asThread('create_block', { parentId: parent, title: 'A branch child' });
      const childName = (child.body as { block: { name: string } }).block.name;
      expect(yield* asThread('update_block', { blockId: childName, parentId: mainParentName })).toMatchObject({
        status: 409,
        body: { code: 'not-found' },
      });
      expect(yield* read(childName, destination)).toMatchObject({ parentName: parent });
      expect(
        yield* asThread('create_block', {
          parentId: parent,
          title: 'A branch task with a main-only origin',
          tags: ['task'],
          edges: [{ kind: 'discovered-from', to: mainParentName }],
        }),
      ).toMatchObject({ status: 409, body: { code: 'not-found' } });
      const filing = { title: 'friction on this branch', command: 'tagma op x', expected: 'a branch record', actual: 'a branch defect' };
      const filed = yield* answered(yield* doors.atNative('file_reflection', filing, placed));
      expect(filed.block).toMatchObject({ parentName: area });
      expect(filed.receivedBy).toEqual(WORLD_SOURCE);
      const entry = (filed.block as { name: string }).name;
      const recorded = yield* read(entry);
      expect(yield* read(entry, destination)).toEqual(recorded);
      expect(yield* asThread('read_block', { blockIds: [entry] })).toMatchObject({ status: 200, body: { reads: [recorded] } });
      expect(recorded).toMatchObject({ projectId: project, answered: false });
      const sighted = yield* answered(yield* doors.atHttp('file_reflection', { ...filing, ontoId: entry }, placed));
      expect(sighted).toMatchObject({ block: { name: entry }, sightings: 2 });
      const listed = yield* answered(yield* doors.atHttp('read_reflections', {}, placed));
      expect((listed.blocks as { name: string; sightings: number }[]).find((row) => row.name === entry)?.sightings).toBe(2);
      yield* files.writeFileString(join(world.sourceCheckout, 'server', 'fix'), 'main-only fix');
      yield* suiteGit(world.sourceCheckout, 'commit', '-qam', 'fix after the branch was cut');
      const mainFix = yield* suiteGit(world.sourceCheckout, 'rev-parse', 'HEAD');
      yield* answered(yield* doors.atHttp('answer_reflection', { blockId: entry, commit: mainFix }, placed));
      expect(yield* read(entry)).toMatchObject({ answeredCommit: mainFix });
      yield* answered(yield* doors.atNative('unanswer_reflection', { blockId: entry, commit: mainFix }, placed));
      yield* files.writeFileString(join(destination, 'server', 'fix'), 'branch fix');
      yield* suiteGit(destination, 'commit', '-qam', 'branch fix');
      const fix = yield* suiteGit(destination, 'rev-parse', 'HEAD');
      expect(yield* asThread('answer_reflection', { blockId: entry, commit: fix })).toMatchObject({
        status: 409,
        body: { code: 'commit-unlanded' },
      });
      expect(yield* read(entry)).toMatchObject({ answered: false });
    }),
  );

  it.effect('a base past new code stays the approved one, and graph.commit off keeps it and reports the graph files left in main', () =>
    Effect.gen(function* () {
      const { world, project, parent } = yield* Place;
      const files = yield* FileSystem.FileSystem;
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const repositories = (yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer;
      const repository = repositories.repositories[0]!.binding;
      const guarded = join(yield* files.realPath(yield* world.directory('code-worktree')), 'code');
      const approved = yield* op('prepare_worktree', {
        operationId: 'code',
        repository,
        destination: guarded,
        mode: { kind: 'new-branch', branch: 'code', start: 'HEAD' },
      });
      const approvedBase = (approved.body as { operation: { base: string } }).operation.base;
      yield* files.writeFileString(join(world.sourceCheckout, 'server', 'value.ts'), 'export const value = 3;\n');
      yield* suiteGit(world.sourceCheckout, 'commit', '-qm', 'code moves after the approval', '--', 'server/value.ts');
      expect((yield* op('create_block', { tags: ['task'], title: 'A graph change beside new code', parentId: parent })).status).toBe(200);
      expect(yield* op('create_worktree', { operationId: 'code' })).toMatchObject({
        status: 200,
        body: { operation: { base: approvedBase } },
      });
      expect(yield* files.readFileString(join(guarded, 'server', 'value.ts'))).toBe(
        yield* suiteGitText(world.sourceCheckout, 'show', `${approvedBase}:server/value.ts`),
      );
      yield* Effect.addFinalizer(() =>
        Context.get(world.runtime.owners, Settings)
          .write({ scope: 'project', projectId: project, key: 'graph.commit', value: 'manual' })
          .pipe(Effect.orDie),
      );
      expect((yield* op('write_setting', { project, key: 'graph.commit', value: 'off' })).status).toBe(200);
      const task = yield* op('create_block', { tags: ['task'], title: 'An uncommitted main task under off', parentId: parent });
      const name = (task.body as { block: { name: string } }).block.name;
      const destination = join(yield* files.realPath(yield* world.directory('off-worktree')), 'off');
      const prepared = yield* op('prepare_worktree', {
        operationId: 'off',
        repository,
        destination,
        mode: { kind: 'new-branch', branch: 'off', start: 'HEAD' },
      });
      expect(prepared.status).toBe(200);
      const base = (prepared.body as { operation: { base: string } }).operation.base;
      yield* world.runtime.pool.releaseProject(project);
      const created = yield* op('create_worktree', { operationId: 'off' });
      expect(created).toMatchObject({
        status: 200,
        body: {
          operation: {
            base,
            status: 'ready',
            evidence: { graphLeft: { reason: 'commit-off', checkout: yield* files.realPath(world.sourceCheckout) } },
          },
        },
      });
      const left = (created.body as { operation: { evidence: { graphLeft: { files: number } } } }).operation.evidence.graphLeft;
      expect(left.files).toBeGreaterThan(0);
      expect(yield* read(name)).toMatchObject({ fields: { status: 'open' } });
      for (const checkout of [world.sourceCheckout, destination]) expect(yield* suiteGit(checkout, 'rev-parse', 'HEAD')).toBe(base);
      expect(yield* suiteGit(destination, 'status', '--porcelain', '--', '.tagma')).toBe('');
    }),
  );
});

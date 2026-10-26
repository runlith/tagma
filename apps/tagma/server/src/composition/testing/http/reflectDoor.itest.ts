import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer, Ref } from 'effect';
import { join } from 'node:path';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { doorFixture, DoorFixture, projectLeaving, WORLD_SOURCE } from '../doorFixture.js';

const setup = Effect.gen(function* () {
  return {
    world: yield* DoorFixture,
    other: yield* Ref.make<number | null>(null),
    source: yield* Ref.make<number | null>(null),
  };
});
class Filing extends Context.Service<Filing, Effect.Success<typeof setup>>()('testing/Filing') {}
const op = (id: string, input: unknown, project?: number) =>
  Effect.flatMap(Filing, ({ world }) => world.op(id, input, project === undefined ? '' : `project=${project}`));
const born = (project: number, input: unknown) =>
  Effect.map(op('create_block', input, project), (answer) => (answer.body as { block: { name: string } }).block.name);
const read = Effect.fnUntraced(function* (name: string, project: number) {
  const response = yield* op('read_block', { blockIds: [name] }, project);
  expect(response.status).toBe(200);
  return (response.body as { reads: Record<string, unknown>[] }).reads[0] as Record<string, unknown>;
});
const standing = Effect.map(
  op('read_reflections', {}),
  (answer) => (answer.body as { blocks: { name: string; sightings: number }[] }).blocks,
);
type Filed = { block: { name: string; parentName: string | null; tags: string[]; title: string; fields: unknown }; receivedBy: unknown };
const ownProject = Effect.gen(function* () {
  const { world, source } = yield* Filing;
  const held = yield* Ref.get(source);
  if (held !== null) return held;
  const registered = ((yield* op('list_projects', {})).body as { projects: { id: number; name: string }[] }).projects;
  const own = registered.find((row) => row.name === 'tagma');
  let id = own?.id;
  if (id === undefined) {
    yield* git('init', '-q', '-b', 'main');
    yield* git('commit', '--allow-empty', '-qm', 'initial');
    const added = yield* op('add_project', { name: 'tagma', rootPath: world.sourceCheckout, storage: 'stealth' });
    expect(added).toMatchObject({ status: 200 });
    id = (added.body as { project: { id: number } }).project.id;
    yield* projectLeaving(world, id);
  }
  yield* Ref.set(source, id);
  return id;
});
const otherProject = Effect.gen(function* () {
  const { world, other } = yield* Filing;
  const held = yield* Ref.get(other);
  if (held !== null) return held;
  const added = yield* op('add_project', { name: world.uniqueName(), rootPath: yield* world.directory('other'), storage: 'stealth' });
  expect(added.status).toBe(200);
  const id = (added.body as { project: { id: number } }).project.id;
  yield* projectLeaving(world, id);
  yield* Ref.set(other, id);
  return id;
});
const serverModule = Effect.fnUntraced(function* (sourceProjectId: number) {
  const { world } = yield* Filing;
  yield* (yield* FileSystem.FileSystem).makeDirectory(join(world.sourceCheckout, 'server'), { recursive: true });
  const set = yield* op('set_module', { modules: [{ id: 'server', title: 'The Server', root: 'server' }] }, sourceProjectId);
  expect(set).toMatchObject({ status: 200 });
  return (set.body as { modules: { card: string }[] }).modules[0]!.card;
});
const git = Effect.fnUntraced(function* (...args: string[]) {
  const { world } = yield* Filing;
  const ran = yield* spawnedEffect(['git', '-c', 'user.email=tagma@test', '-c', 'user.name=tagma', ...args], { cwd: world.sourceCheckout });
  if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')}: ${ran.stderr.toString()}`));
  return ran.stdout.toString().trim();
});

layer(doorFixture(), { excludeTestServices: true })('reflections HTTP door', (it) => {
  it.effect('a foreign reflection preserves provenance and sightings, and task or commit answers can be tracked and withdrawn', () =>
    Effect.gen(function* () {
      const filing = {
        title: 'verify answers drifted about the block it just re-pinned',
        command: 'tagma verify 3206',
        expected: 'the block reads verified',
        actual: 'it printed drifted',
      };
      const homeless = yield* op('file_reflection', filing);
      expect(homeless.status).toBe(409);
      expect(homeless.body).toMatchObject({ code: 'no-home' });
      expect((homeless.body as { unblock: string[] }).unblock.length).toBeGreaterThan(0);
      const sourceProjectId = yield* ownProject;
      const areaId = yield* serverModule(sourceProjectId);
      const otherId = yield* otherProject;
      const filed = yield* op('file_reflection', filing, otherId);
      expect(filed.status).toBe(200);
      const answer = filed.body as Filed;
      expect(answer.block).toMatchObject({ parentName: areaId, tags: ['reflection'], title: filing.title });
      expect(answer.block.fields).toEqual({ command: filing.command, expected: filing.expected, actual: filing.actual });
      const row = yield* read(answer.block.name, sourceProjectId);
      expect(row.projectId).toBe(sourceProjectId);
      const recorded = row.body as string;
      const project = (yield* op('read_project', {}, otherId)).body as { project: { name: string } };
      expect(recorded).toContain(`project \`${project.project.name}\``);
      expect(recorded).toContain(WORLD_SOURCE.startedAt);
      expect(recorded).toContain(WORLD_SOURCE.revision.head);
      expect(answer.receivedBy).toEqual(WORLD_SOURCE);
      const claimed = yield* op('file_reflection', {
        ...filing,
        title: 'a filing that names its own server',
        receivedBy: { startedAt: 'yesterday', revision: null },
      });
      expect(claimed.status).toBe(409);
      expect(claimed.body).toMatchObject({ code: 'body-shape', reason: expect.stringContaining('receivedBy') });
      const mood = yield* op('file_reflection', { title: 'x', command: 'y', expected: 'z' });
      expect(mood.status).toBe(409);
      expect(mood.body).toMatchObject({ code: 'body-shape' });
      const firstId = answer.block.name;
      const second = yield* op('file_reflection', {
        title: 'verify prints drifted for the block it has just re-pinned',
        command: 'tagma verify 1214',
        expected: 'the block reads verified',
        actual: 'it printed drifted',
      });
      expect(second).toMatchObject({ status: 200 });
      const echoes = (second.body as { already: { name: string; shared: number }[] }).already;
      expect(echoes.map((row) => row.name)).toContain(firstId);
      expect(echoes[0]?.shared).toBeGreaterThan(0);
      const firstBody = (yield* read(firstId, sourceProjectId)).body;
      const onto = yield* op('file_reflection', {
        title: 'verify still prints drifted',
        command: 'tagma verify 1721',
        expected: 'verified',
        actual: 'drifted again',
        ontoId: firstId,
      });
      expect(onto.status).toBe(200);
      const sighted = onto.body as Filed & { sightings: number; block: { fields: { command: string } } };
      expect(sighted.block.name).toBe(firstId);
      expect((yield* read(firstId, sourceProjectId)).body).toBe(firstBody);
      expect(sighted.sightings).toBe(2);
      expect(sighted.block.fields.command).toBe('tagma verify 3206');
      expect(sighted.receivedBy).toEqual(WORLD_SOURCE);
      const entries = yield* standing;
      expect(entries.map((row) => row.name)).toContain(firstId);
      expect(entries.find((row) => row.name === firstId)?.sightings).toBe(2);
      const firstPage = (yield* op('read_reflections', { limit: 1 })).body as {
        blocks: { name: string }[];
        total: number;
        shown: number;
        next: string;
      };
      expect(firstPage).toMatchObject({ shown: 1, total: entries.length });
      const secondPage = yield* op('read_reflections', { limit: 1, cursor: firstPage.next });
      expect(secondPage.status).toBe(200);
      expect(secondPage.body).toMatchObject({ shown: 1, total: entries.length });
      expect((secondPage.body as { blocks: { name: string }[] }).blocks[0]?.name).not.toBe(firstPage.blocks[0]?.name);
      const secondId = (second.body as Filed).block.name;
      yield* op('supersede_block', { oldId: secondId, withId: firstId }, sourceProjectId);
      const remainingIds = (yield* standing).map((row) => row.name);
      expect(remainingIds).toContain(firstId);
      expect(remainingIds).not.toContain(secondId);
      const stray = yield* op('file_reflection', { title: 't', command: 'c', expected: 'e', actual: 'a', ontoId: areaId });
      expect(stray.status).toBe(409);
      expect(stray.body).toMatchObject({ code: 'not-a-reflection' });
      const fix = yield* born(sourceProjectId, {
        tags: ['task'],
        title: 'make verify answer with the state it produced',
        edges: [{ kind: 'discovered-from', to: firstId }],
      });
      expect((yield* standing).map((row) => row.name)).toContain(firstId);
      yield* op('finish_block', { blockId: fix }, sourceProjectId);
      expect((yield* standing).map((row) => row.name)).not.toContain(firstId);
      expect((yield* op('read_block', { blockIds: [firstId] }, sourceProjectId)).status).toBe(200);
      const returned = yield* op('file_reflection', {
        title: 'it came back',
        command: 'tagma verify 9',
        expected: 'verified',
        actual: 'drifted',
        ontoId: firstId,
      });
      expect(returned.status).toBe(409);
      expect(returned.body).toMatchObject({ code: 'already-answered' });
      yield* Effect.gen(function* () {
        const { world } = yield* Filing;
        const sourceProjectId = yield* ownProject;
        const otherId = yield* otherProject;
        yield* (yield* FileSystem.FileSystem).writeFileString(join(world.sourceCheckout, 'server', 'fix'), 'fixed');
        yield* git('add', '-A');
        yield* git('commit', '-qm', 'the fix');
        const fix = yield* git('rev-parse', 'HEAD');
        const filed = yield* op(
          'file_reflection',
          { title: 'a fixed friction', command: 'tagma op x', expected: 'one act', actual: 'two' },
          otherId,
        );
        const entry = (filed.body as Filed).block.name;
        const both = yield* op('answer_reflection', { blockId: entry, by: entry, commit: fix }, otherId);
        expect(both.status).toBe(409);
        expect(both.body).toMatchObject({ code: 'answer-shape' });
        const answered = yield* op('answer_reflection', { blockId: entry, commit: fix.slice(0, 12) }, otherId);
        expect(answered.status).toBe(200);
        expect((yield* standing).map((row) => row.name)).not.toContain(entry);
        expect(yield* read(entry, sourceProjectId)).toMatchObject({ answeredCommit: fix });
        const withdrawn = yield* op('unanswer_reflection', { blockId: entry, commit: fix }, otherId);
        expect(withdrawn.status).toBe(200);
        expect((yield* standing).map((row) => row.name)).toContain(entry);
        expect(yield* read(entry, sourceProjectId)).toMatchObject({ answeredCommit: null });
      });
    }).pipe(Effect.provide(Layer.effect(Filing, setup).pipe(Layer.provideMerge(BunFileSystem.layer)))),
  );
});

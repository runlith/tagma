import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Queue } from 'effect';
import { GraphFeed, type GraphFrame } from '../../../graph/contract/service/journal.js';
import type { JournalPageBody } from '../../../graph/contract/wire/journal.js';
import { graphHome, stealthTreeName } from '../../../graph/storage/layout.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

type Written = { readonly block: { readonly name: string } };

const TAGMA = 'Tagma <agent@tagma.app>';
const LONG_TITLE = "The team tree's commit stream belongs to the tree and survives every reopening without another graph write";

const lastCommit = (root: string) =>
  Effect.map(suiteGit(root, 'log', '-1', '--format=%an <%ae>%x00%cn <%ce>%x00%B'), (text) => {
    const [author, committer, message = ''] = text.split('\0');
    const [subject = '', ...rest] = message.split('\n');
    return { author, committer, subject, lines: rest.filter((line) => line !== '') };
  });

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('graph commits', (it) => {
  const teamProject = Effect.fnUntraced(function* (label: string, history: readonly string[]) {
    const world = yield* DoorFixture;
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.realPath(yield* world.directory(label));
    yield* suiteGit(root, 'init', '-q', '-b', 'main');
    for (const subject of history) {
      yield* files.writeFileString(join(root, 'code.txt'), `${subject}\n`);
      yield* suiteGit(root, 'add', 'code.txt');
      yield* suiteGit(root, 'commit', '-q', '-m', subject);
    }
    const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
    const project = (born.body as { project: { id: number } }).project.id;
    yield* projectLeaving(world, project);
    expect((yield* world.op('sync_graph', { project })).status).toBe(200);
    const parentId = ((yield* world.op('list_root_blocks', { project })).body as { blocks: { name: string }[] }).blocks[0]!.name;
    const created = (input: Record<string, unknown>) =>
      Effect.map(world.op('create_block', { project, parentId, ...input }), (answer) => (answer.body as Written).block.name);
    return { world, root, project, created, parentId };
  });

  it.effect(
    'a team graph commit follows a Conventional Commits history: Tagma signs it, one body line per act, the position in a trailer',
    () =>
      Effect.gen(function* () {
        const { world, root, project, created } = yield* teamProject('conventional', [
          'feat(core): seed the code',
          'fix(core): mend the seed',
          'Merge the seed',
        ]);
        const explanation = yield* created({ tags: ['explanation'], title: LONG_TITLE });
        expect((yield* world.op('sync_graph', { project })).status).toBe(200);
        const single = yield* lastCommit(root);
        expect(single.subject).toBe(`docs(graph): add explanation "The team tree's commit stream belongs to…"`);
        expect(single.lines.slice(0, -1)).toEqual([`add ${explanation} ${LONG_TITLE}`]);
        expect(single.lines.at(-1)).toMatch(/^Tagma-Graph: [0-9]+$/);
        const spec = yield* created({ tags: ['spec'], title: LONG_TITLE });
        const task = yield* created({ tags: ['task'], title: 'Build the assembler', parentId: spec });
        for (const body of ['first draft', 'second draft']) {
          expect((yield* world.op('update_block', { project, blockId: task, body })).status).toBe(200);
        }
        expect((yield* world.op('finish_block', { project, blockId: task })).status).toBe(200);
        expect((yield* world.op('sync_graph', { project })).status).toBe(200);

        const commit = yield* lastCommit(root);
        expect([commit.author, commit.committer]).toEqual([TAGMA, TAGMA]);
        expect(commit.subject).toBe(`docs(graph): open spec "The team tree's commit stream…" and 3 more`);
        expect(commit.lines.slice(0, -1)).toEqual([
          `open ${spec} ${LONG_TITLE}`,
          `open ${task} Build the assembler`,
          `edit ${task} Build the assembler`,
          `finish ${task} Build the assembler`,
        ]);
        expect(commit.lines.at(-1)).toMatch(/^Tagma-Graph: [0-9]+$/);
      }),
  );

  it.effect('a team graph commit in a history without Conventional Commits is a plain capitalized phrase', () =>
    Effect.gen(function* () {
      const { world, root, project, created } = yield* teamProject('plain', ['Seed the code', 'feat: one conventional', 'Mend the seed']);
      const note = yield* created({ tags: ['explanation'], title: LONG_TITLE });
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const commit = yield* lastCommit(root);
      expect(commit.author).toBe(TAGMA);
      expect(commit.subject).toBe(`Add explanation "The team tree's commit stream belongs to the tree and…"`);
      expect(commit.lines.slice(0, -1)).toEqual([`add ${note} ${LONG_TITLE}`]);

      const split = yield* created({ title: 'Billing\n\nquestions' });
      const faq = yield* created({ title: 'Refund FAQ' });
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const counted = yield* lastCommit(root);
      expect(counted.subject).toBe('Add 2 notes');
      expect(counted.lines.slice(0, 2)).toEqual([`add ${split} Billing questions`, `add ${faq} Refund FAQ`]);
    }),
  );

  it.effect('a cross-project move names the departing block and its destination in the source journal and commit', () =>
    Effect.gen(function* () {
      const source = yield* teamProject('departure-source', ['feat(core): seed the source']);
      const target = yield* teamProject('departure-target', ['feat(core): seed the target']);
      const name = yield* source.created({ title: 'Knowledge to move' });
      expect((yield* source.world.op('sync_graph', { project: source.project })).status).toBe(200);
      const served = yield* source.world.runtime.pool.resolve({ projectId: source.project });
      const changes = yield* Queue.unbounded<GraphFrame>();
      const stop = yield* Context.get(served.context, GraphFeed).subscribe(source.project, (frame) => Queue.offerUnsafe(changes, frame));
      yield* Effect.addFinalizer(() => Effect.sync(stop));
      const moved = yield* source.world.op('update_block', { project: source.project, blockId: name, parentId: target.parentId });
      expect(moved).toMatchObject({ status: 200 });
      const events = yield* source.world.op('read_events', { project: source.project, limit: 1 });
      const targetProject = (
        (yield* source.world.op('read_project', {}, `project=${target.project}`)).body as { project: { name: string } }
      ).project;
      expect(events.body).toMatchObject({
        events: [{ op: 'depart', blockName: name, destination: { label: targetProject.name } }],
      });
      for (;;) {
        const frame = yield* Queue.take(changes);
        if (frame.type !== 'change' || !frame.events.some((entry) => entry.op === 'depart')) continue;
        expect(frame.events).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'depart', blockName: name })]));
        break;
      }
      const journal = (yield* source.world.op('read_journal', { project: source.project, limit: 1 })).body as JournalPageBody;
      const departure = journal.batches[0]!;
      expect(departure).toMatchObject({ moved: { name, title: 'Knowledge to move', destination: { label: targetProject.name } } });
      expect(journal.blocks.find((row) => row.name === departure.blockName)?.title).toBe('Knowledge to move');
      const history = yield* source.world.op('read_block_diff', {
        project: source.project,
        blockId: departure.blockName,
        from: departure.firstEventId - 1,
        to: departure.lastEventId,
      });
      expect(history).toMatchObject({ status: 200, body: { diff: { changes: [expect.objectContaining({ kind: 'move' })] } } });
      expect((yield* source.world.op('sync_graph', { project: source.project })).status).toBe(200);
      const commit = yield* lastCommit(source.root);
      expect(commit.lines[0]).toBe(`move ${name} Knowledge to move to ${target.parentId}`);
      expect((yield* source.world.op('restore_block', { project: source.project, blockId: departure.blockName })).status).toBe(200);
      expect(
        (yield* source.world.op('update_block', { project: source.project, blockId: departure.blockName, title: 'Restored copy' })).status,
      ).toBe(200);
      const after = (yield* source.world.op('read_journal', { project: source.project, limit: 10 })).body as JournalPageBody;
      expect(after.batches.find((batch) => batch.ops.includes('restore'))?.blockName).toBe(departure.blockName);
      expect(after.batches.flatMap((batch) => (batch.moved === undefined ? [] : [batch.moved.name]))).toEqual([name]);
      expect(after.batches.find((batch) => batch.ops.includes('depart'))).toMatchObject({
        blockName: departure.blockName,
        moved: { name, title: 'Knowledge to move' },
      });
    }),
  );

  it.effect('an act a storage move already published is not named again by the next commit of the moved graph', () =>
    Effect.gen(function* () {
      const { world, project, created } = yield* teamProject('moving', ['feat(core): seed the code']);
      yield* created({ title: 'Carried by the move' });
      expect((yield* world.op('set_project_storage', { ref: String(project), mode: 'stealth' })).status).toBe(200);
      const after = yield* created({ title: 'After the move' });
      yield* world.runtime.pool.releaseProject(project);
      const log = (yield* world.op('read_block_log', { project, blockId: after })).body as { log: readonly { message: string }[] };
      expect(log.log[0]?.message).toBe('docs(graph): add note "After the move"');
    }),
  );

  it.effect('the stealth graph commits through the same assembler, and the team commit of a mixed act names only team blocks', () =>
    Effect.gen(function* () {
      const { world, root, project, created, parentId } = yield* teamProject('stealth', ['feat(core): seed the code']);
      const terms = yield* created({ title: 'Vendor terms', storage: 'stealth' });
      yield* world.runtime.pool.releaseProject(project);
      const hidden = yield* lastCommit(join(graphHome(world.dataHome, project), 'layers', stealthTreeName(root)));
      expect([hidden.author, hidden.committer]).toEqual([TAGMA, TAGMA]);
      expect(hidden.subject).toBe('docs(graph): add note "Vendor terms"');
      expect(hidden.lines[0]).toBe(`add ${terms} Vendor terms`);
      expect(hidden.lines.at(-1)).toMatch(/^Tagma-Graph: [0-9]+$/);

      const batch = yield* world.op('apply_batch', {
        project,
        source: JSON.stringify({
          ops: [
            { op: 'create', title: 'Deals', storage: 'stealth', parentId },
            { op: 'create', $id: 'visible', tags: ['explanation'], title: LONG_TITLE, parentId },
          ],
        }),
      });
      expect(batch.status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const team = yield* lastCommit(root);
      expect(team.subject).toBe(`docs(graph): add explanation "The team tree's commit stream belongs to…"`);
      const visible = (batch.body as { ids: { visible: string } }).ids.visible;
      expect(team.lines.slice(0, -1)).toEqual([`add ${visible} ${LONG_TITLE}`]);
      expect(team.lines.at(-1)).toMatch(/^Tagma-Graph: [0-9]+$/);
    }),
  );
});

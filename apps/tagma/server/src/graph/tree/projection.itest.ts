import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import { scanTree } from './scan.js';
import { ShadowGit } from './shadow.js';
import { projectToTree, restorePaths, syncProject } from './projection.js';
import { treeLedger } from './ledger.js';

layer(demoGraphLayer({ repos: ['projection'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'graph write-through',
  (it) => {
    it.effect('acts publish stable identities, suffix references and attributed history; a no-op publishes no commit', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId, root } = demo;
          const treeRoot = demo.project('projection').root;
          const shadow = yield* ShadowGit.openInPlace(treeRoot, graph.git);
          const target = yield* graph.blocks.create({
            projectId,
            tags: ['idea'],
            title: 'The Charter',
            body: 'the standing law',
            parentId: root,
          });
          const body = `it points at [[${spokenId(target.uuid)}]]`;
          const pointer = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'The Pointer', body, parentId: root });
          const sync = (message: string) => syncProject({ projectId, treeRoot, shadow, message });
          const first = yield* sync('create both');
          expect(first.commit).toBeString();
          const scanned = new Map((yield* scanTree(treeRoot)).blocks.map((row) => [row.frontmatter.id, row]));
          expect([scanned.get(target.uuid)?.frontmatter.title, scanned.get(pointer.uuid)?.body]).toEqual(['The Charter', body]);
          expect((yield* sync('no act happened')).commit).toBeNull();
          yield* graph.blocks.update({ id: target.id, body: 'the standing law, amended' });
          const third = yield* sync('amend the charter');
          expect(third.commit).toBeString();
          const after = (yield* scanTree(treeRoot)).blocks.find((row) => row.frontmatter.id === target.uuid);
          expect([after?.frontmatter.id, after?.body]).toEqual([target.uuid, 'the standing law, amended']);
          const acts = (yield* shadow.log(treeRoot)).slice(0, 2);
          expect([third.commit, first.commit]).toEqual(acts.map((act) => act.commit));
          expect(acts.map((act) => [act.author, act.message])).toEqual([
            ['Tagma', 'amend the charter'],
            ['Tagma', 'create both'],
          ]);
        }),
      ),
    );

    it.effect('trash and rename leave exactly the surviving block at its new address, whose history follows the move', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId, root } = demo;
          const treeRoot = demo.project('projection').root;
          const shadow = yield* ShadowGit.openInPlace(treeRoot, graph.git);
          const doomed = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Doomed', body: '', parentId: root });
          const renamed = yield* graph.blocks.create({
            projectId,
            tags: ['idea'],
            title: 'Old Name',
            parentId: root,
            body: 'A body of real size, because git stores no renames: history follows a moved file only by content similarity, and a near-empty block gives it nothing to match.',
          });
          yield* syncProject({ projectId, treeRoot, shadow, message: 'create both' });
          yield* graph.trash.delete({ id: doomed.id });
          yield* graph.blocks.update({ id: renamed.id, title: 'New Name' });
          expect((yield* syncProject({ projectId, treeRoot, shadow, message: 'trash one, rename the other' })).commit).toBeString();
          const held = (yield* scanTree(treeRoot)).blocks.filter(
            (row) => row.frontmatter.id === doomed.uuid || row.frontmatter.id === renamed.uuid,
          );
          expect(held.map((row) => [row.frontmatter.id, row.frontmatter.title])).toEqual([[renamed.uuid, 'New Name']]);
          const path = (yield* graph.blocks.blockById(renamed.id)).path;
          if (path === null) return yield* Effect.die('the renamed block has no projected path');
          expect((yield* shadow.log(treeRoot, path)).map((act) => act.message)).toEqual(['trash one, rename the other', 'create both']);
        }),
      ),
    );

    it.effect('the ledger detects edits and deletions; restoring touched paths recovers exact bytes and removes the stray subtree', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId, root } = demo;
          const fs = yield* FileSystem.FileSystem;
          const treeRoot = yield* demo.fixture.directory('projection');
          const parent = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Shelf', body: 'holds', parentId: root });
          const first = yield* graph.blocks.create({ projectId, parentId: parent.id, tags: ['idea'], title: 'Kept', body: 'kept' });
          const second = yield* graph.blocks.create({ projectId, parentId: parent.id, tags: ['idea'], title: 'Gone', body: 'gone' });
          yield* graph.sources.attach({ blockId: first.id, kind: 'file', ref: 'first.ts' });
          yield* graph.sources.attach({ blockId: second.id, kind: 'file', ref: 'second.ts' });
          yield* graph.edges.link({ fromId: first.id, kind: 'relates', toId: second.id });
          yield* projectToTree({ projectId, treeRoot });
          const files = Effect.fnUntraced(function* () {
            const held = new Map<string, string>();
            for (const path of yield* fs.readDirectory(treeRoot, { recursive: true })) {
              if (path.split('/').some((part) => part.startsWith('.'))) continue;
              if ((yield* fs.stat(join(treeRoot, path))).type === 'File') held.set(path, yield* fs.readFileString(join(treeRoot, path)));
            }
            return held;
          });
          const before = yield* files();
          const kept = [...before.keys()].find((path) => path.endsWith('/kept.md'));
          const gone = [...before.keys()].find((path) => path.endsWith('/gone.md'));
          if (kept === undefined || gone === undefined) return yield* Effect.die('the projection omitted a child');
          const changes = [
            { status: 'M', path: kept },
            { status: 'M', path: gone },
          ];
          const ledger = yield* treeLedger({ root: treeRoot, stealth: null }, projectId);
          expect(yield* ledger.unreflected(changes)).toEqual([]);
          yield* fs.writeFileString(join(treeRoot, kept), 'half written');
          yield* fs.remove(join(treeRoot, gone));
          const changed = [
            { status: 'M', path: kept },
            { status: 'D', path: gone },
          ];
          expect((yield* ledger.unreflected(changed)).toSorted((a, b) => a.path.localeCompare(b.path))).toEqual(
            changed.toSorted((a, b) => a.path.localeCompare(b.path)),
          );
          yield* fs.makeDirectory(join(treeRoot, 'demo', 'moved'), { recursive: true });
          yield* fs.writeFileString(join(treeRoot, 'demo', 'moved', 'index.md'), 'a subtree the act moved here');
          yield* restorePaths({ projectId, treeRoot, paths: [kept, gone, 'demo/moved'] });
          expect(yield* files()).toEqual(before);
          expect(yield* fs.exists(join(treeRoot, 'demo', 'moved'))).toBe(false);
          expect(yield* ledger.unreflected([])).toEqual([]);
        }),
      ),
    );
  },
);

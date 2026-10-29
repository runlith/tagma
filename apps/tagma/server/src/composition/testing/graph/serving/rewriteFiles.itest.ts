import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { block } from '../../../../graph/store/tables.js';
import { TREE_PAIRS } from '../../../../graph/operations/projects.js';
import { decodeBlockFile } from '../../../../graph/tree/blockFile.js';
import { onGraph, signedBy, withGraphCall } from '../../../../invocation/testing/call.js';
import { servingLayer, withServing } from './fixture.js';

layer(servingLayer, { excludeTestServices: true })('file rewriting', (it) => {
  it.effect('rewriting a one-line document preserves every block and is idempotent', () =>
    withServing(({ served, projectId }) =>
      Effect.gen(function* () {
        const blocks = yield* Blocks;
        const db = (yield* GraphStore).db;
        const fs = yield* FileSystem.FileSystem;
        const root = yield* blocks.rootBlockOf(projectId);
        const made = yield* signedBy({ harness: 'claude-code', key: 'rewrite' })(
          blocks.create({ projectId, parentId: root.id, tags: ['spec'], title: 'An old form', body: 'kept as written' }),
        );
        const row = yield* blocks.rawBlockById(made.id);
        if (row.path === null) return yield* Effect.die('the projected block has no path');
        const path = join(served.layout.treeRoot, row.path);
        const current = yield* fs.readFileString(path);
        const indented = /^fields:\n((?: {2}.*\n)+)/m.exec(current);
        if (indented === null) return yield* Effect.die('the projected document has no fields');
        const parsed = yield* decodeBlockFile(current);
        yield* fs.writeFileString(path, current.replace(indented[0], `fields: ${JSON.stringify(parsed.frontmatter.fields)}\n`));
        const before = yield* db.select().from(block).orderBy(block.id);
        const rewrite = () =>
          TREE_PAIRS.rewrite_graph_files.body
            .execute({}, { project: 'repo', root: served.layout.treeRoot }, { actor: { kind: 'operator' }, files: null })
            .pipe(onGraph(served), withGraphCall(Effect.die('file rewriting executes against the served graph, not GraphCall')));
        expect(yield* rewrite()).toMatchObject({ status: 'ok', rewritten: { written: 1 } });
        expect(yield* fs.readFileString(path)).toBe(current);
        expect(yield* db.select().from(block).orderBy(block.id)).toEqual(before);
        expect(yield* rewrite()).toMatchObject({ status: 'ok', rewritten: { written: 0, removed: 0 } });
      }),
    ),
  );
});

import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { batchDocument } from '../contract/wire/batch.js';
import { isEnabled } from '../contract/wire/tags/law.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { signedBy, signedCall } from '../../invocation/testing/call.js';

layer(demoGraphLayer(), { excludeTestServices: true })('blocks', (it) => {
  it.effect('lifecycle words are owned by their operations and finished work offers reopening', () =>
    withDemo(({ graph, projectId, refusal, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'task', parentId: root });
        expect((yield* refusal(graph.blocks.update({ id, status: 'done' }))).code).toBe('status-operation');
        expect((yield* refusal(graph.blocks.update({ id, status: 'closed' }))).code).toBe('status-operation');
        yield* graph.tasks.claim({ id });
        yield* graph.tasks.finish({ id });
        const revive = yield* refusal(graph.tasks.claim({ id }));
        expect(revive.code).toBe('illegal-transition');
        expect(revive.unblock).toHaveLength(1);
        expect(revive.unblock.join(' ')).toContain('open (update_block)');
        expect((yield* refusal(graph.blocks.update({ id, status: 'in_work' }))).code).toBe('status-operation');
      }),
    ),
  );

  it.effect('a status-operation refusal names the verb that owns the word on this tag', () =>
    withDemo(({ graph, projectId, nameOf, refusal, table, root }) =>
      Effect.gen(function* () {
        const target = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'amended', body: 'the old line', parentId: root });
        const filed = yield* graph.review.propose({
          projectId,
          amendsId: target.id,
          title: 'a finding',
          ops: [{ op: 'edit', id: yield* nameOf(target.id), old: 'the old line', new: 'the new line' }],
        });
        const refused = yield* refusal(graph.blocks.update({ id: filed.id, status: 'applied' }));
        expect(refused.code).toBe('status-operation');
        expect(refused.unblock[0]).toBe(`accept_amendment on ${yield* nameOf(filed.id)}`);
        expect((yield* table()).statusOf(yield* graph.review.accept({ id: filed.id }))).toBe('applied');
      }),
    ),
  );

  it.effect('a spec refuses in_work and done, and reads as building while an implementing task is claimed', () =>
    withDemo(({ graph, projectId, refusal, root }) =>
      Effect.gen(function* () {
        const { id: specId } = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec', parentId: root });
        expect((yield* refusal(graph.blocks.update({ id: specId, status: 'in_work' }))).code).toBe('illegal-status');
        expect((yield* refusal(graph.tasks.finish({ id: specId }))).code).toBe('illegal-status');
        const { id: taskId } = yield* graph.blocks.create({
          projectId,
          tags: ['task'],
          title: 'build it',
          parentId: root,
          edges: [{ kind: 'implements', to: specId }],
        });
        expect((yield* graph.reading.show(specId, 0)).building).toBe(false);
        yield* graph.tasks.claim({ id: taskId });
        expect((yield* graph.reading.show(specId, 0)).building).toBe(true);
        yield* graph.tasks.release({ id: taskId });
        expect((yield* graph.reading.show(specId, 0)).building).toBe(false);
        yield* graph.tasks.claim({ id: taskId });
        yield* graph.tasks.finish({ id: taskId });
        expect((yield* graph.reading.show(specId, 0)).building).toBe(false);
      }),
    ),
  );

  it.effect('a node without a lifecycle carries no status, and naming one refuses', () =>
    withDemo(({ graph, projectId, table, refusal, root }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const doc = yield* graph.blocks.create({ projectId, title: 'd', parentId: root });
        expect(tags.statusOf(yield* graph.blocks.blockById(doc.id))).toBeNull();
        const refused = yield* refusal(graph.blocks.update({ id: doc.id, status: 'in_work' }));
        expect(refused.code).toBe('no-status');
        expect(refused.unblock).not.toBeEmpty();
        for (const tag of ['zone', 'rule'] as const) {
          const node = yield* graph.blocks.create({ projectId, tags: [tag], title: tag, parentId: root });
          expect(tags.statusOf(yield* graph.blocks.blockById(node.id))).toBeNull();
        }
        const filed = yield* graph.blocks.create({
          projectId,
          tags: ['reflection'],
          title: 'r',
          parentId: root,
          fields: { command: 'tagma supersede L-1 --with L-2', expected: 'one act', actual: 'a delete' },
        });
        const read = yield* graph.blocks.create({
          projectId,
          tags: ['research'],
          title: 's',
          parentId: root,
          fields: { source: { name: 'codex', ref: '.external/codex@ab12' } },
        });
        expect(tags.statusOf(yield* graph.blocks.blockById(filed.id))).toBeNull();
        expect(tags.statusOf(yield* graph.blocks.blockById(read.id))).toBeNull();
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec', parentId: root });
        expect(tags.statusOf(yield* graph.blocks.blockById(spec.id))).toBe('open');
      }),
    ),
  );

  it.effect('a null parent moves a block under the project root, and its own descendant is refused', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const root = yield* graph.blocks.rootBlockOf(projectId);
        const parent = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'p', parentId: root.id });
        const child = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'c', parentId: parent.id });
        expect((yield* refusal(graph.blocks.update({ id: parent.id, parentId: child.id }))).code).toBe('tree-cycle');
        expect((yield* graph.blocks.update({ id: child.id, parentId: null })).parentId).toBe(root.id);
        expect((yield* refusal(graph.blocks.update({ id: root.id, parentId: null }))).code).toBe('project-root');
      }),
    ),
  );

  it.effect('only a rule is switched, and each flip is journalled by direction', () =>
    withDemo(({ graph, projectId, table, refusal, root }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const rule = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Bun only', parentId: root });
        expect(isEnabled(tags.lawProjection(rule), rule)).toBe(true);
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec', parentId: root });
        expect((yield* refusal(graph.blocks.setEnabled({ id: spec.id, enabled: false }))).code).toBe('not-rule');
        yield* graph.blocks.setEnabled({ id: rule.id, enabled: false });
        const disabled = yield* graph.blocks.blockById(rule.id);
        expect(isEnabled(tags.lawProjection(disabled), disabled)).toBe(false);
        yield* graph.blocks.setEnabled({ id: rule.id, enabled: false });
        yield* graph.blocks.setEnabled({ id: rule.id, enabled: true });
        const flips = (yield* graph.journal.events({ blockId: rule.id })).filter(
          (entry) => entry.op === 'enable' || entry.op === 'disable',
        );
        expect(flips.map((entry) => entry.op)).toEqual(['enable', 'disable']);
      }),
    ),
  );

  it.effect('missing and ambiguous anchors preserve the body, and --all replaces every occurrence', () =>
    withDemo(({ graph, projectId, refusal, root }) =>
      Effect.gen(function* () {
        const body = 'the first line\nthe second line\none two one two one';
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body, parentId: root });
        const missing = yield* refusal(graph.blocks.edit({ id, old: 'the third line', new: 'x' }));
        expect(missing.code).toBe('anchor-not-found');
        expect(missing.unblock.length).toBeGreaterThan(0);
        expect((yield* graph.blocks.blockById(id)).body).toBe(body);
        const ambiguous = yield* refusal(graph.blocks.edit({ id, old: 'one', new: 'ONE' }));
        expect(ambiguous.code).toBe('anchor-ambiguous');
        expect(ambiguous.reason).toContain('3');
        expect((yield* graph.blocks.blockById(id)).body).toBe(body);
        yield* graph.blocks.edit({ id, old: 'one', new: 'ONE', all: true });
        expect((yield* graph.blocks.blockById(id)).body).toBe('the first line\nthe second line\nONE two ONE two ONE');
      }),
    ),
  );

  it.effect('a replacement lands verbatim and an empty replacement deletes exactly its own text', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'doc',
          parentId: root,
          body: 'keep this, drop that, PLACEHOLDER here',
        });
        yield* graph.blocks.edit({ id, old: 'PLACEHOLDER', new: '[[deadbeef]] $& $1 $` costs $100' });
        expect((yield* graph.blocks.blockById(id)).body).toBe('keep this, drop that, [[deadbeef]] $& $1 $` costs $100 here');
        yield* graph.blocks.edit({ id, old: 'drop that, ', new: '' });
        expect((yield* graph.blocks.blockById(id)).body).toBe('keep this, [[deadbeef]] $& $1 $` costs $100 here');
      }),
    ),
  );

  it.effect('concurrent title and anchored body writes both land', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body: 'the old body', parentId: root });
        yield* Effect.all([graph.blocks.update({ id, title: 'the new title' }), graph.blocks.edit({ id, old: 'old', new: 'new' })], {
          concurrency: 2,
        });
        const written = yield* graph.blocks.blockById(id);
        expect({ title: written.title, body: written.body }).toEqual({ title: 'the new title', body: 'the new body' });
      }),
    ),
  );

  it.effect('concurrent anchored edits of different text both land', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body: 'alpha beta', parentId: root });
        const session = { harness: 'test', key: 'one-model-step' } as const;
        yield* Effect.all(
          [
            graph.blocks.edit({ id, old: 'alpha', new: 'ALPHA' }).pipe(signedBy(session), signedCall('call-alpha')),
            graph.blocks.edit({ id, old: 'beta', new: 'BETA' }).pipe(signedBy(session), signedCall('call-beta')),
          ],
          { concurrency: 2 },
        );
        expect((yield* graph.blocks.blockById(id)).body).toBe('ALPHA BETA');
      }),
    ),
  );

  it.effect('concurrent anchored edits of the same text refuse the loser with the winning call', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body: 'alpha beta', parentId: root });
        const session = { harness: 'test', key: 'one-model-step' } as const;
        const call = (callId: string, replacement: string) =>
          graph.blocks.edit({ id, old: 'alpha', new: replacement }).pipe(signedBy(session), signedCall(callId), Effect.result);
        const outcomes = yield* Effect.all([call('call-first', 'FIRST'), call('call-second', 'SECOND')], { concurrency: 2 });
        expect(outcomes.map((outcome) => outcome._tag).sort()).toEqual(['Failure', 'Success']);
        const won = outcomes.findIndex((outcome) => outcome._tag === 'Success');
        const lost = outcomes.find((outcome) => outcome._tag === 'Failure');
        if (lost?._tag !== 'Failure') return yield* Effect.die('one sibling must refuse');
        expect(lost.failure).toMatchObject({ _tag: 'GateRefusal', code: 'anchor-not-found' });
        if (lost.failure._tag !== 'GateRefusal') return yield* Effect.fail(lost.failure);
        expect(lost.failure.reason).toContain(won === 0 ? 'call-first' : 'call-second');
        expect((yield* graph.blocks.blockById(id)).body).toBe(won === 0 ? 'FIRST beta' : 'SECOND beta');
      }),
    ),
  );

  it.effect('an edit refuses on a block in the trash', () =>
    withDemo(({ graph, projectId, refusal, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body: 'body', parentId: root });
        yield* graph.trash.delete({ id });
        expect((yield* refusal(graph.blocks.edit({ id, old: 'body', new: 'other' }))).code).toBe('deleted');
      }),
    ),
  );

  it.effect('edits in one batch compose in order and a failed anchor rolls the document back', () =>
    withDemo(({ graph, projectId, nameOf, refusal, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body: 'alpha beta', parentId: root });
        const name = yield* nameOf(id);
        yield* graph.batch.apply(
          batchDocument([
            { op: 'edit', id: name, old: 'alpha', new: 'gamma' },
            { op: 'edit', id: name, old: 'gamma beta', new: 'gamma delta' },
          ]),
          projectId,
        );
        expect((yield* graph.blocks.blockById(id)).body).toBe('gamma delta');
        const refused = yield* refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'edit', id: name, old: 'gamma', new: 'epsilon' },
              { op: 'edit', id: name, old: 'nothing like this', new: 'x' },
            ]),
            projectId,
          ),
        );
        expect(refused.code).toBe('anchor-not-found');
        expect((yield* graph.blocks.blockById(id)).body).toBe('gamma delta');
      }),
    ),
  );

  it.effect('a handle reference written by an edit resolves inside the batch', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'doc', body: 'links: PLACEHOLDER', parentId: root });
        const rootName = yield* nameOf(root);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'edit', id: yield* nameOf(id), old: 'PLACEHOLDER', new: '[[$fresh]]' },
            { op: 'create', $id: 'fresh', tags: ['idea'], title: 'fresh', parentId: rootName },
          ]),
          projectId,
        );
        expect((yield* graph.blocks.blockById(id)).body).toBe(`links: [[${result.ids.fresh}]]`);
      }),
    ),
  );

  it.effect('search retains unchanged text across moves and follows title and body replacements', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const parent = yield* graph.blocks.create({ projectId, title: 'Shelf', parentId: root });
        const doc = yield* graph.blocks.create({ projectId, title: 'Maple', body: 'orchid', parentId: root });
        const name = yield* nameOf(doc.id);
        yield* graph.blocks.update({ id: doc.id, parentId: parent.id, ord: 2 });
        expect((yield* graph.ranking.search({ projectId, query: 'orchid' })).items.map((row) => row.name)).toEqual([name]);
        yield* graph.blocks.update({ id: doc.id, title: 'Birch', body: 'cedar' });
        expect((yield* graph.ranking.search({ projectId, query: 'birch cedar' })).items.map((row) => row.name)).toEqual([name]);
        expect((yield* graph.ranking.search({ projectId, query: 'orchid' })).items).toEqual([]);
      }),
    ),
  );

  it.effect('a subtree shape counts blocks, depth and the widest shelf, and skips the trash', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const area = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'shaped', parentId: root });
        const hub = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'hub', parentId: area.id });
        for (const title of ['a', 'b', 'c']) yield* graph.blocks.create({ projectId, tags: ['idea'], title, parentId: hub.id });
        const deep = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'deep', parentId: area.id });
        const deeper = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'deeper', parentId: deep.id });
        const gone = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'gone', parentId: deeper.id });
        yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'under gone', parentId: gone.id });
        yield* graph.trash.delete({ id: gone.id });
        expect(yield* graph.selection.shape(area.id)).toEqual({ blocks: 6, depth: 2, widest: 3 });
        expect((yield* graph.reading.show(area.id, 1)).children.find((child) => child.id === hub.id)?.shape).toEqual({
          blocks: 3,
          depth: 1,
          widest: 3,
        });
        expect(yield* graph.selection.shape(deeper.id)).toEqual({ blocks: 0, depth: 0, widest: 0 });
      }),
    ),
  );

  it.effect('a hit names its container: the parent title rides the page', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const area = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Learning Engine', parentId: root });
        const nested = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'The Journal', parentId: area.id });
        const rootLevel = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'The Journal', parentId: root });
        const hits = (yield* graph.ranking.search({ query: 'journal', projectId })).items;
        const nestedName = yield* nameOf(nested.id);
        const rootName = yield* nameOf(rootLevel.id);
        expect(hits.find((hit) => hit.name === nestedName)?.parentTitle).toBe('Learning Engine');
        expect(hits.find((hit) => hit.name === rootName)?.parentTitle).toBe('demo');
      }),
    ),
  );
});

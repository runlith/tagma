import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Option, Tracer } from 'effect';
import { blockName } from '../contract/wire/references.js';
import { batchDocument, batchSource } from '../contract/wire/batch.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('apply batch', (it) => {
  it.effect('finish ends created work in the same atomic document', () =>
    withDemo(({ graph, projectId, table, root, nameOf }) =>
      Effect.gen(function* () {
        const home = yield* nameOf(root);
        const answer = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'job', tags: ['task'], title: 'batch work', parentId: home },
            { op: 'finish', id: '$job' },
          ]),
          projectId,
        );
        const id = yield* graph.blockNames.idOfName(answer.ids.job!);
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(id))).toBe('done');
      }),
    ),
  );

  it.effect('handles wire created blocks together', () =>
    withDemo(({ graph, projectId, root, nameOf }) =>
      Effect.gen(function* () {
        const home = yield* nameOf(root);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 's', tags: ['spec'], title: 'batch spec', parentId: home },
            {
              op: 'create',
              $id: 't',
              parentId: home,
              tags: ['task'],
              title: 'batch task',
              edges: [
                { kind: 'implements', to: '$s' },
                { kind: 'relates', to: '$s' },
              ],
            },
          ]),
          projectId,
        );
        const edges = (yield* graph.reading.show(yield* graph.blockNames.idOfName(result.ids.t!), 0)).edgesOut;
        expect(edges.some((e) => e.kind === 'implements' && blockName(e.toUuid ?? '') === result.ids.s)).toBe(true);
        expect(edges.some((e) => e.kind === 'relates' && blockName(e.toUuid ?? '') === result.ids.s)).toBe(true);
      }),
    ),
  );

  it.effect('a payload accepted in the same document resolves that document’s handles', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const amended = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: 'the amended doc' })).id;
        const amendedName = yield* nameOf(amended);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'target', tags: ['idea'], title: 'the block the payload names', parentId: yield* nameOf(root) },
            {
              op: 'propose',
              $id: 'p',
              amendsId: amendedName,
              title: 'names a block of the document around it',
              ops: [{ op: 'update', id: amendedName, body: 'Read [[$target]] beside this.' }],
            },
            { op: 'accept', id: '$p', reason: 'the finding stands' },
          ]),
          projectId,
        );
        expect((yield* graph.blocks.blockById(amended)).body).toBe(`Read [[${result.ids.target}]] beside this.`);
      }),
    ),
  );

  it.effect('a handle declared with its dollar resolves in parentId and in link alike', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: '$node', tags: ['idea'], title: 'dollar-declared root', parentId: yield* nameOf(root) },
            { op: 'create', $id: 'leaf', tags: ['idea'], title: 'dollar-declared child', parentId: '$node' },
            { op: 'link', fromId: '$leaf', kind: 'relates', toId: '$node' },
          ]),
          projectId,
        );
        const leaf = yield* graph.blockNames.idOfName(result.ids.leaf!);
        expect(yield* nameOf((yield* graph.blocks.blockById(leaf)).parentId ?? 0)).toBe(result.ids.node!);
        expect(
          (yield* graph.reading.show(leaf, 0)).edgesOut.some((e) => e.kind === 'relates' && blockName(e.toUuid ?? '') === result.ids.node),
        ).toBe(true);
      }),
    ),
  );

  it.effect('a view saves the subtrees its own document creates', () =>
    withDemo(({ graph, projectId, root, nameOf }) =>
      Effect.gen(function* () {
        const home = yield* nameOf(root);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'w', tags: ['zone'], title: 'watched area', parentId: home },
            { op: 'create', $id: 's', tags: ['spec'], title: 'watched spec', parentId: '$w' },
            {
              op: 'create',
              $id: 't',
              tags: ['task'],
              title: 'builds the watched spec',
              parentId: '$w',
              edges: [{ kind: 'implements', to: '$s' }],
            },
            {
              op: 'create',
              $id: 'v',
              parentId: home,
              tags: ['view'],
              title: 'work on the new spec',
              fields: { query: { scope: ['$w'], edge: { kind: 'implements', to: '$s' }, sort: { by: 'updated', order: 'desc' } } },
            },
          ]),
          projectId,
        );
        const page = (yield* graph.reading.show(yield* graph.blockNames.idOfName(result.ids.v!), 0)).results;
        expect(page?.missingScope).toEqual([]);
        expect(page?.items.map((row) => row.name)).toEqual([result.ids.t!]);
      }),
    ),
  );

  it.effect('a view naming a handle no create declared refuses the whole document', () =>
    withDemo(({ graph, projectId, refusal, root, nameOf }) =>
      Effect.gen(function* () {
        const home = yield* nameOf(root);
        const refused = yield* refusal(
          graph.batch.apply(
            batchDocument([
              {
                op: 'create',
                parentId: home,
                tags: ['view'],
                title: 'marmoset view',
                fields: { query: { scope: ['$ghost'], sort: { by: 'updated', order: 'desc' } } },
              },
            ]),
            projectId,
          ),
        );
        expect(refused.code).toBe('batch-ref');
        expect((yield* graph.ranking.search({ query: 'marmoset', projectId })).items).toHaveLength(0);
      }),
    ),
  );

  it.effect('a catalog names the tags its own document declares beneath it', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const result = yield* graph.batch.apply(
          batchDocument([
            {
              op: 'create',
              $id: 'catalog',
              tags: ['catalog'],
              title: 'study',
              parentId: yield* nameOf(root),
              fields: { id: 'study', tags: ['$topic'] },
            },
            { op: 'create', $id: 'topic', tags: ['tag'], title: '#topic', parentId: '$catalog', fields: { id: 'topic' } },
          ]),
          projectId,
        );
        const catalog = yield* graph.blockNames.idOfName(result.ids.catalog!);
        expect((yield* graph.blocks.blockById(catalog)).fields.tags).toEqual([result.ids.topic]);
        const declared = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(result.ids.topic!));
        expect(yield* nameOf(declared.parentId ?? 0)).toBe(result.ids.catalog!);
      }),
    ),
  );

  it.effect('a name reached ahead of its create is judged against its field once the document has run', () =>
    withDemo(({ graph, projectId, refusal, root, nameOf }) =>
      Effect.gen(function* () {
        const home = yield* nameOf(root);
        const refused = yield* refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', tags: ['catalog'], title: 'misnamed study', parentId: home, fields: { id: 'misnamed', tags: ['$idea'] } },
              { op: 'create', $id: 'idea', tags: ['idea'], title: 'an idea, not a declaration', parentId: home },
            ]),
            projectId,
          ),
        );
        expect(refused.code).toBe('field-target');
        expect(refused.reason).toStartWith('ops[0] (create)');
        expect((yield* graph.ranking.search({ query: 'misnamed study', projectId })).items).toHaveLength(0);
      }),
    ),
  );

  it.effect('a create refused on its fields reports its own refusal while a catalog awaits it', () =>
    withDemo(({ graph, projectId, refusal, root, nameOf }) =>
      Effect.gen(function* () {
        const home = yield* nameOf(root);
        const refused = yield* refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', tags: ['catalog'], title: 'awaiting study', parentId: home, fields: { id: 'awaiting', tags: ['$broken'] } },
              {
                op: 'create',
                $id: 'broken',
                tags: ['tag'],
                title: '#broken',
                parentId: home,
                fields: { id: 'broken', gates: 'not gates' },
              },
            ]),
            projectId,
          ),
        );
        expect(refused.code).toBe('field-invalid');
        expect(refused.reason).toStartWith('ops[1] (create)');
      }),
    ),
  );

  it.effect('a document exposes indexed operations and bounded post-pass spans', () =>
    withDemo(({ graph, projectId, nameOf, root: top }) =>
      Effect.gen(function* () {
        const existing = (yield* graph.blocks.create({ projectId, parentId: top, tags: ['idea'], title: 'span destination' })).id;
        const spans: Tracer.NativeSpan[] = [];
        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const privateBody = 'Never expose this body: [[$target]].';
        const result = yield* graph.batch
          .apply(
            batchDocument([
              { op: 'create', $id: 'target', tags: ['idea'], title: 'span target', body: 'target body', parentId: yield* nameOf(top) },
              { op: 'update', id: yield* nameOf(existing), body: privateBody },
            ]),
            projectId,
          )
          .pipe(Effect.withTracer(tracer));
        const root = spans.find((span) => span.name === 'Amendments.runDocument');
        const rewrite = spans.find((span) => span.name === 'Amendments.rewriteHandles');
        const projection = spans.find((span) => span.name === 'Amendments.project');
        const operations = spans.filter((span) => span.name === 'Amendments.op');
        if (root === undefined || rewrite === undefined || projection === undefined) {
          return yield* Effect.fail('the Amendments phase tree is incomplete');
        }
        const descendsFrom = (span: Tracer.Span, ancestor: Tracer.Span): boolean => {
          let parent = Option.getOrUndefined(span.parent);
          while (parent !== undefined) {
            if (parent.spanId === ancestor.spanId) return true;
            parent = parent._tag === 'Span' ? Option.getOrUndefined(parent.parent) : undefined;
          }
          return false;
        };
        expect(operations).toHaveLength(2);
        for (const phase of [...operations, rewrite, projection]) expect(descendsFrom(phase, root)).toBe(true);
        expect(operations.map((span) => Object.fromEntries(span.attributes))).toEqual([
          { actId: expect.any(String), opKind: 'create', opIndex: 0, graphId: projectId },
          { actId: expect.any(String), opKind: 'update', opIndex: 1, graphId: projectId },
        ]);
        const written = result.ops.filter((outcome) => 'refsIn' in outcome);
        const bodyBytes = written.reduce((bytes, outcome) => bytes + new TextEncoder().encode(outcome.body).byteLength, 0);
        const rootAttributes = Object.fromEntries(root.attributes);
        expect(rootAttributes).toMatchObject({ actId: expect.any(String), graphId: projectId, writtenBlocks: written.length, bodyBytes });
        expect(Object.fromEntries(rewrite.attributes)).toMatchObject({
          actId: rootAttributes.actId,
          graphId: projectId,
          writtenBlocks: written.length,
        });
        expect(Object.fromEntries(projection.attributes)).toMatchObject({
          actId: rootAttributes.actId,
          graphId: projectId,
          writtenBlocks: written.length,
          bodyBytes,
        });
        expect(JSON.stringify([root, rewrite, projection, ...operations].flatMap((span) => [...span.attributes]))).not.toContain(
          privateBody,
        );
      }),
    ),
  );

  it.effect('unknown creation fields at either document depth refuse instead of dropping relations', () =>
    withDemo(({ graph, projectId, nameOf, refusal, root }) =>
      Effect.gen(function* () {
        const target = yield* graph.blocks.create({ projectId, parentId: root, tags: ['spec'], title: 'target' });
        const name = yield* nameOf(target.id);
        const create = {
          op: 'create',
          tags: ['task'],
          title: 'must retain intent',
          parentId: name,
          edges: [{ kind: 'implements', to: name }],
        };
        for (const op of [
          { ...create, implementsId: name },
          { op: 'propose', amendsId: name, title: 'nested intent', ops: [{ ...create, discoveredFromId: name }] },
          { op: 'propose', amendsId: name, title: 'deferred claim', ops: [{ ...create, claim: true }] },
        ]) {
          expect((yield* refusal(graph.batch.apply(batchDocument([op]), projectId))).code).toBe('bad-document');
          expect(yield* graph.blocks.childrenOf(target.id)).toEqual([]);
        }
      }),
    ),
  );

  it.effect('a bare operations array refuses and retains its editable source', () =>
    withDemo(({ graph, projectId, refusal, root, nameOf }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const source = JSON.stringify([{ op: 'create', tags: ['idea'], title: 'array member', parentId: yield* nameOf(root) }]);
        const refused = yield* refusal(graph.batch.apply({ source }, projectId));
        expect(refused.code).toBe('bad-document');
        expect(yield* fs.readFileString(refused.inputFile!)).toBe(source);
      }),
    ),
  );

  it.effect('a refused batch rolls back and returns an editable source that can be applied', () =>
    withDemo(({ graph, projectId, nameOf, table, refusal, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* nameOf(root);
        const container = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'protected' })).id;
        const source = batchSource([
          { op: 'create', tags: ['task'], title: 'rolled back', parentId: home },
          { op: 'update', id: yield* nameOf(container), status: 'in_work' },
        ]);
        const refused = yield* refusal(graph.batch.apply({ source }, projectId));
        expect(refused.code).toBe('no-status');
        expect(yield* fs.readFileString(refused.inputFile!)).toBe(source);
        expect((yield* graph.ranking.search({ query: 'rolled back', projectId })).items).toHaveLength(0);
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(container))).toBeNull();
        yield* fs.writeFileString(
          refused.inputFile!,
          batchSource([{ op: 'create', tags: ['task'], title: 'corrected quokka from file', parentId: home }]),
        );
        yield* graph.batch.apply({ file: refused.inputFile! }, projectId);
        expect((yield* graph.ranking.search({ query: 'corrected quokka', projectId })).items).toHaveLength(1);
      }),
    ),
  );

  it.effect('relative bodies are read at application or filing, and accepted proposals survive their file’s removal', () =>
    withDemo(({ graph, projectId, fixture, root: top, nameOf }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fixture.directory('caller');
        const text = 'A body the caller typed, with "quotes", a newline\nand no escaping at all.';
        yield* fs.writeFileString(join(root, 'one.md'), text);
        const file = join(root, 'document.json');
        yield* fs.writeFileString(
          file,
          batchSource([
            { op: 'create', $id: 'd', tags: ['idea'], title: 'body by file', body: { file: 'one.md' }, parentId: yield* nameOf(top) },
          ]),
        );
        const inline = yield* graph.batch.apply({ file }, projectId);
        const amendedName = inline.ids.d!;
        expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(amendedName))).body).toBe(text);

        const body = 'The child body, written as a file.';
        yield* fs.writeFileString(join(root, 'child.md'), body);
        yield* fs.writeFileString(
          file,
          batchSource([
            {
              op: 'propose',
              $id: 'p',
              amendsId: amendedName,
              title: 'adds a child',
              ops: [{ op: 'create', tags: ['idea'], title: 'the proposed child', parentId: amendedName, body: { file: 'child.md' } }],
            },
          ]),
        );
        const result = yield* graph.batch.apply({ file }, projectId);
        yield* fs.remove(join(root, 'child.md'));
        yield* graph.review.accept({ id: yield* graph.blockNames.idOfName(result.ids.p!) });
        const [child] = (yield* graph.ranking.search({ query: 'the proposed child', projectId })).items;
        expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(child!.name))).body).toBe(body);
      }),
    ),
  );

  it.effect('a refusal raised after the op loop still names the body file its op read', () =>
    withDemo(({ graph, projectId, fixture, refusal, root: top, nameOf }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fixture.directory('caller');
        const body = '[[$h]]';
        const home = yield* nameOf(top);
        yield* graph.blocks.create({
          projectId,
          parentId: top,
          tags: ['tag'],
          title: '#bounded',
          fields: { id: 'bounded', body: { shape: 'content', cap: body.length } },
        });
        yield* fs.writeFileString(join(root, 'law.md'), body);
        const file = join(root, 'document.json');
        yield* fs.writeFileString(
          file,
          batchSource([
            { op: 'create', $id: 'h', tags: ['idea'], title: 'the handle the law names', parentId: home },
            { op: 'create', tags: ['bounded'], title: 'bounded data', body: { file: 'law.md' }, parentId: home },
          ]),
        );
        const refused = yield* refusal(graph.batch.apply({ file }, projectId));
        expect(refused.code).toBe('body-capped');
        expect(refused.inputFile).toBe(join(root, 'law.md'));
      }),
    ),
  );

  it.effect('a refusal of an op’s fields names the document, not the body file the op read', () =>
    withDemo(({ graph, projectId, fixture, refusal, root: top, nameOf }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fixture.directory('caller');
        yield* fs.writeFileString(join(root, 'guidance.md'), 'How the study runs.');
        const file = join(root, 'document.json');
        yield* fs.writeFileString(
          file,
          batchSource([
            {
              op: 'create',
              parentId: yield* nameOf(top),
              tags: ['catalog'],
              title: 'bad member',
              body: { file: 'guidance.md' },
              fields: { id: 'bad', tags: ['tTopic'] },
            },
          ]),
        );
        const refused = yield* refusal(graph.batch.apply({ file }, projectId));
        expect(refused.code).toBe('field-invalid');
        expect(refused.inputFile).toBe(file);
      }),
    ),
  );

  it.effect('relative document and body paths refuse without the caller’s base', () =>
    withDemo(({ graph, projectId, refusal, root, nameOf }) =>
      Effect.gen(function* () {
        const refused = yield* refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', tags: ['idea'], title: 'nowhere to measure from', body: { file: 'one.md' }, parentId: yield* nameOf(root) },
            ]),
            projectId,
          ),
        );
        expect(refused.code).toBe('body-source');
        expect(refused.reason).toContain('operation 1');
        expect((yield* refusal(graph.batch.apply({ file: 'document.json' }, projectId))).code).toBe('batch-source');
      }),
    ),
  );

  it.effect('a replaced record is corrected in one document and stays replaced, or the whole correction rolls back', () =>
    withDemo(({ graph, projectId, nameOf, refusal, root }) =>
      Effect.gen(function* () {
        const old = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['spec'],
          title: 'draft',
          body: 'keeps the token s3cret here',
        });
        const successor = yield* graph.blocks.create({ projectId, parentId: root, tags: ['spec'], title: 'accepted' });
        yield* graph.standing.supersede({ oldId: old.id, withId: successor.id });
        const [oldName, successorName] = [yield* nameOf(old.id), yield* nameOf(successor.id)];
        const correction = (text: string) =>
          batchDocument([
            { op: 'unsupersede', id: oldName },
            { op: 'edit', id: oldName, old: text, new: '' },
            { op: 'supersede', oldId: oldName, withId: successorName },
          ]);
        expect((yield* refusal(graph.batch.apply(correction(' absent'), projectId))).code).toBe('anchor-not-found');
        expect(yield* graph.standing.successorOf(old.id)).toBe(successor.id);
        yield* graph.batch.apply(correction(' s3cret'), projectId);
        expect((yield* graph.blocks.blockById(old.id)).body).toBe('keeps the token here');
        expect(yield* graph.standing.successorOf(old.id)).toBe(successor.id);
      }),
    ),
  );
});

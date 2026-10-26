import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { Selection } from '../../../../graph/contract/service/reads.js';
import { CatalogGraph } from '../../../../graph/vocabulary/install.js';
import { meta } from '../../../../graph/store/tables.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { writes } from '../../../../platform/contract/service/writes.js';
import { FORMAT_FILE, VOCABULARY_FORMAT_KEY } from '../../../../graph/contract/wire/storage.js';
import { shippedSteps } from '../../../../graph/steps/sequence.js';
import { VOCABULARY_FORMAT } from '../../../../graph/contract/wire/tags/revision.js';
import { runGit } from '../../../../platform/git/ownGit.js';
import { servingLayer, type Serving, withServing } from './fixture.js';

const stamping = writes('test', [meta]);
const CURRENT = { step: shippedSteps.last };
const NEWER = VOCABULARY_FORMAT + 1;
const UNKNOWN_STEP = 'a-step-of-a-newer-release';
const OLDER = { graph: 1, vocabulary: 2 };
const signed = signedBy({ harness: 'claude-code', key: 'format' });

const makeFormat = Effect.fnUntraced(function* ({ demo, pool, served: initial, projectId }: Serving) {
  let served = initial;
  const fs = yield* FileSystem.FileSystem;
  const file = join(served.layout.treeRoot, FORMAT_FILE);
  const create = (title: string) =>
    signed(Context.get(served.context, Blocks).create({ projectId, tags: ['idea'], title, body: title })).pipe(
      Effect.provide(served.context),
    );
  const installing = Effect.fnUntraced(
    function* () {
      const graph = yield* CatalogGraph;
      if (graph === null) return yield* Effect.die('the served graph has no catalog writer');
      yield* (yield* graph(projectId))(['software-development']);
    },
    (effect) => Effect.provide(effect, served.context),
  );
  const reopen = Effect.fnUntraced(function* () {
    yield* pool.release(served);
    served = yield* pool.resolve({ projectId });
  });
  const stamp = (value: string) => {
    const store = Context.get(served.context, GraphStore);
    return store.transaction(stamping, () =>
      store.db.insert(meta).values({ key: VOCABULARY_FORMAT_KEY, value }).onConflictDoUpdate({ target: meta.key, set: { value } }),
    );
  };
  const stored = () => Context.get(served.context, GraphStore).db.select().from(meta).where(eq(meta.key, VOCABULARY_FORMAT_KEY)).get();
  const marker = () => fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))));
  const note = yield* create('Standing note');
  const records = () => Context.get(served.context, Selection).records([note.id]);
  return { demo, fs, file, note, create, installing, reopen, stamp, stored, marker, records, current: () => served, projectId };
});

layer(servingLayer, { excludeTestServices: true })('vocabulary format', (it) => {
  it.effect(
    'a newer tree stays readable while refusing writes and installs, a lost marker is restored by the next act, and an unpublishable step refuses before changing a block',
    () =>
      withServing((serving) =>
        Effect.gen(function* () {
          const { demo, fs, file, note, create, installing, reopen, marker, records, current } = yield* makeFormat(serving);

          yield* reopen();
          expect(yield* marker()).toEqual(CURRENT);
          expect(
            yield* runGit(demo.graph.git, 'tracked', ['-C', current().layout.treeRoot, 'ls-tree', '--name-only', 'HEAD', FORMAT_FILE]),
          ).toBe(FORMAT_FILE);
          yield* fs.writeFileString(file, `${JSON.stringify({ step: UNKNOWN_STEP })}\n`);
          yield* current().settled(true);
          const newerTree = yield* demo.refusal(create('Written over a newer tree'));
          expect(newerTree.code).toBe('vocabulary-newer');
          expect(newerTree.reason).toContain(UNKNOWN_STEP);
          expect((yield* demo.refusal(installing())).code).toBe('vocabulary-newer');
          expect((yield* records()).map((row) => row.title)).toEqual(['Standing note']);
          expect(yield* marker()).toEqual({ step: UNKNOWN_STEP });
          yield* fs.writeFileString(file, `${JSON.stringify(CURRENT)}\n`);
          yield* current().settled(true);
          expect((yield* create('Written once the tree reads again')).body).toBe('Written once the tree reads again');

          yield* fs.remove(file);
          yield* current().settled(true);
          expect((yield* create('Written after the marker went')).body).toBe('Written after the marker went');
          expect(yield* marker()).toEqual(CURRENT);

          const held = current();
          const blocks = Context.get(held.context, Blocks);
          const before = yield* blocks.rawBlockById(note.id);
          yield* fs.chmod(held.layout.treeRoot, 0o555);
          yield* Effect.gen(function* () {
            yield* fs.writeFileString(file, `${JSON.stringify(OLDER)}\n`);
            expect((yield* Effect.result(held.settled(true)))._tag).toBe('Failure');
            expect((yield* demo.refusal(signed(blocks.update({ id: note.id, title: 'Not published' })))).code).toBe('graph-pool');
            expect(yield* blocks.rawBlockById(note.id)).toEqual(before);
            expect(yield* fs.readFileString(file)).toBe(`${JSON.stringify(OLDER)}\n`);
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                yield* fs.chmod(held.layout.treeRoot, 0o755);
                yield* fs.writeFileString(file, `${JSON.stringify(CURRENT)}\n`);
                yield* held.settled(true);
              }).pipe(Effect.orDie),
            ),
          );
        }),
      ),
  );

  it.effect('an older marker and store open at the current step and allow declarations, and a newer store permits only reads', () =>
    withServing((serving) =>
      Effect.gen(function* () {
        const { demo, fs, file, create, installing, reopen, stamp, stored, marker, records, current, projectId } =
          yield* makeFormat(serving);
        yield* fs.writeFileString(file, `${JSON.stringify(OLDER)}\n`);
        yield* stamp('1');
        yield* reopen();
        expect(yield* marker()).toEqual(CURRENT);
        expect((yield* stored())?.value).toBe(String(VOCABULARY_FORMAT));
        expect((yield* records()).map((row) => row.title)).toEqual(['Standing note']);
        const tag = yield* signed(
          Context.get(current().context, Blocks).create({
            projectId,
            tags: ['tag'],
            title: '#subidea',
            body: 'A narrower idea.',
            fields: { id: 'subidea', extends: 'idea' },
          }),
        ).pipe(Effect.provide(current().context));
        expect(tag.fields).toMatchObject({ id: 'subidea', extends: 'shipped:software-development/idea' });

        yield* stamp(String(NEWER));
        yield* reopen();
        const newerStore = yield* demo.refusal(create('Written over a newer store'));
        expect(newerStore.code).toBe('vocabulary-newer');
        expect(newerStore.reason).toContain(`vocabulary format ${NEWER}`);
        expect(newerStore.reason).toContain(`format ${VOCABULARY_FORMAT}`);
        expect((yield* demo.refusal(installing())).code).toBe('vocabulary-newer');
        expect((yield* stored())?.value).toBe(String(NEWER));
        expect((yield* records()).map((row) => row.title)).toEqual(['Standing note']);
      }),
    ),
  );
});

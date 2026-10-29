import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema } from 'effect';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { Tags } from '../../../../graph/contract/service/vocabulary.js';
import { blockName } from '../../../../graph/contract/wire/references.js';
import { agentPreviewSchema } from '../../../../threads/contract/wire/agentLibrary.js';
import { doorFixture, DoorFixture } from '../../doorFixture.js';

const blockAnswer = Schema.Struct({ block: Schema.Struct({ name: Schema.String, fields: Schema.Record(Schema.String, Schema.Unknown) }) });
const readyAnswer = Schema.Struct({ tasks: Schema.Array(Schema.Struct({ name: Schema.String })), total: Schema.Number });
const refusalAnswer = Schema.Struct({ code: Schema.String, reason: Schema.String, unblock: Schema.Array(Schema.String) });
const projectAnswer = Schema.Struct({ project: Schema.Struct({ id: Schema.Number }) });

const success = Effect.fnUntraced(function* (project: number, operation: string, input: unknown) {
  const result = yield* (yield* DoorFixture).op(operation, input, `project=${project}`);
  if (result.status !== 200) yield* Effect.logError(operation, result.body);
  expect(result.status).toBe(200);
  return result.body;
});
const rootOf = Effect.fnUntraced(function* (project: number) {
  const { runtime } = yield* DoorFixture;
  const root = yield* Context.get(runtime.graph, Blocks).rootBlockOf(project).pipe(Effect.provide(runtime.graph));
  return blockName(root.uuid);
});
const create = (project: number, input: Record<string, unknown>) =>
  Effect.flatMap(rootOf(project), (parentId) => success(project, 'create_block', { parentId, ...input })).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(blockAnswer)),
    Effect.map((answer) => answer.block),
  );
const ready = (project: number) =>
  success(project, 'ready_work', { limit: 3 }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(readyAnswer)));
const refuse = Effect.fnUntraced(function* (project: number, operation: string, input: unknown, code: string) {
  const result = yield* (yield* DoorFixture).op(operation, input, `project=${project}`);
  expect(result.status).toBe(409);
  const refusal = yield* Schema.decodeUnknownEffect(refusalAnswer)(result.body);
  expect(refusal.code).toBe(code);
  expect(refusal.unblock.length).toBeGreaterThan(0);
});
const codeInstructions = Effect.fnUntraced(function* (project: number) {
  const preview = yield* Schema.decodeUnknownEffect(agentPreviewSchema)(yield* success(project, 'read_agent', { id: 'tagma' }));
  return preview.prompt.sections.some((section) => section.id === 'the-checkout-and-the-graph');
});
const declareWorkflow = Effect.fnUntraced(function* (project: number, id: string, strict: boolean) {
  const transitions = strict
    ? [
        ['open', 'writing'],
        ['writing', 'open'],
        ['writing', 'done'],
        ['open', 'dropped'],
        ['writing', 'dropped'],
      ]
    : [
        ['done', 'open'],
        ['done', 'dropped'],
      ];
  const declared = yield* create(project, {
    tags: ['tag'],
    title: id,
    fields: {
      id,
      fields: { phase: { type: 'enum', values: ['open', 'writing', 'done', 'dropped'] }, owner: 'session' },
      gates: transitions.map(([from, to]) => ({ gate: 'transition', field: 'phase', from, to })),
      contracts: {
        'core/lifecycle': {
          slots: { status: 'phase' },
          words: {
            initial: strict ? 'open' : 'done',
            done: strict ? 'done' : 'open',
            closed: 'dropped',
            claimed: strict ? 'writing' : undefined,
          },
        },
        'core/work': { slots: {}, words: {} },
        'core/holder': strict ? { slots: { holder: 'owner' }, words: {} } : undefined,
      },
    },
  });
  yield* create(project, { tags: ['catalog'], title: id, fields: { id, tags: [declared.name], profile: { checks: { code: strict } } } });
});

class NeutralProjects extends Context.Service<NeutralProjects, { readonly workflow: number }>()('testing/NeutralProjects') {}

const projects = Layer.effect(
  NeutralProjects,
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const rootPath = yield* world.directory(world.uniqueName());
    const result = yield* world.op('add_project', { name: world.uniqueName(), rootPath, storage: 'stealth', catalogs: [] });
    expect(result.status).toBe(200);
    return { workflow: (yield* Schema.decodeUnknownEffect(projectAnswer)(result.body)).project.id };
  }),
).pipe(Layer.provideMerge(doorFixture()));

layer(projects, { excludeTestServices: true })('vocabulary neutrality', (it) => {
  it.effect('contradictory catalog workflows retain their own lifecycles on one shipped engine', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const project = (yield* NeutralProjects).workflow;
      yield* Effect.addFinalizer(() => world.runtime.pool.releaseProject(project));
      yield* declareWorkflow(project, 'strict-code', true);
      yield* declareWorkflow(project, 'free-writing', false);
      const served = yield* world.runtime.pool.resolve({ projectId: project });
      expect((yield* Context.get(served.context, Tags).of(project)).bindsCode()).toBe(true);
      expect(yield* codeInstructions(project)).toBe(true);
      const strict = yield* create(project, { tags: ['strict-code'], title: 'Ship a verified change' });
      const free = yield* create(project, { tags: ['free-writing'], title: 'Publish a draft' });
      expect(strict.fields.phase).toBe('open');
      expect(free.fields.phase).toBe('done');
      expect(new Set((yield* ready(project)).tasks.map((task) => task.name))).toEqual(new Set([strict.name, free.name]));
      yield* refuse(project, 'finish_block', { blockId: strict.name }, 'illegal-transition');
      const published = yield* Schema.decodeUnknownEffect(blockAnswer)(yield* success(project, 'finish_block', { blockId: free.name }));
      expect(yield* success(project, 'read_block', { blockIds: [free.name] })).toMatchObject({
        reads: [{ name: free.name, fields: { phase: 'open' } }],
      });
      expect(published.block.fields.phase).toBe('open');
      expect((yield* ready(project)).tasks.map((task) => task.name)).toEqual([strict.name]);
      const claimed = yield* Schema.decodeUnknownEffect(blockAnswer)(yield* success(project, 'claim_block', { blockId: strict.name }));
      expect(claimed.block.fields.phase).toBe('writing');
      const shipped = yield* Schema.decodeUnknownEffect(blockAnswer)(yield* success(project, 'finish_block', { blockId: strict.name }));
      expect(shipped.block.fields.phase).toBe('done');
      expect((yield* ready(project)).total).toBe(0);
    }),
  );
});

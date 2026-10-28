import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ToolFailed } from '@runlith/agent/tool';
import { tempRootEffect } from '../graphFixture.js';
import { GraphTools, graphToolsFixture, withGraphTools, type GraphToolContext } from './graphTools.fixture.js';

type Row = { readonly name?: string; readonly id?: number };

const rowsIn = (answer: Record<string, unknown>, key: string): Row[] => {
  const rows = answer[key];
  if (!Array.isArray(rows)) throw new Error(`the answer carries no ${key} rows`);
  return rows as Row[];
};

const keysOf = (rows: readonly Row[]): string[] => rows.map((row) => (typeof row.name === 'string' ? row.name : String(row.id)));

const walk = Effect.fnUntraced(function* (operation: string, input: Record<string, unknown>, key: string, limit: number) {
  const { call } = yield* GraphTools;
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let step = 0; step < 40; step += 1) {
    const answer = yield* call(operation, { ...input, limit, cursor });
    if (answer.status === 'refused') return yield* Effect.die(`${operation} refused: ${String(answer.code)} ${String(answer.reason)}`);
    seen.push(...keysOf(rowsIn(answer, key)));
    const next = answer.next;
    if (next === null || next === undefined) return { seen, pages: step + 1 };
    if (typeof next !== 'string') return yield* Effect.die(`${operation} answered a continuation that is not a cursor`);
    cursor = next;
  }
  return yield* Effect.die(`${operation} never ended its walk`);
});

const refusalOf = Effect.fnUntraced(function* (operation: string, input: Record<string, unknown>, context?: GraphToolContext) {
  const { call, answerWith } = yield* GraphTools;
  const answer = yield* (context === undefined ? call(operation, input) : answerWith(context, operation, input)).pipe(
    Effect.catchTag('Tool.Failed', (failure) => Effect.succeed(failure)),
  );
  if (!(answer instanceof ToolFailed)) expect(answer.status).toBe('refused');
  return answer;
});

layer(graphToolsFixture, { excludeTestServices: true })('graph queue pages', (it) => {
  it.effect(
    'the ready frontier answers the caller’s page, and the walk reaches every task once',
    withGraphTools(function* () {
      const { demo, graph, ctx, call } = yield* GraphTools;
      const projectId = ctx.projectId;
      const root = (yield* graph.blocks.rootBlockOf(projectId)).id;
      const area = yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'work area' });
      for (let at = 0; at < 5; at += 1) yield* graph.blocks.create({ projectId, parentId: area.id, tags: ['task'], title: `work ${at}` });
      const areaName = yield* demo.nameOf(area.id);
      const whole = yield* call('ready_work', {});
      expect(rowsIn(whole, 'tasks')).toHaveLength(5);
      expect(whole.total).toBe(5);
      const first = yield* call('ready_work', { limit: 2 });
      expect(rowsIn(first, 'tasks')).toHaveLength(2);
      expect(first.shown).toBe(2);
      expect(first.total).toBe(5);
      expect(typeof first.next).toBe('string');
      const walked = yield* walk('ready_work', {}, 'tasks', 2);
      expect(walked.pages).toBe(3);
      expect(walked.seen).toEqual(keysOf(rowsIn(whole, 'tasks')));
      expect(new Set(walked.seen).size).toBe(5);
      const scoped = yield* call('ready_work', { limit: 2, scopeId: areaName });
      expect(typeof scoped.next).toBe('string');
      const continued = yield* call('ready_work', { limit: 2, cursor: scoped.next as string });
      expect(continued.total).toBe(5);
      expect(new Set([...keysOf(rowsIn(scoped, 'tasks')), ...keysOf(rowsIn(continued, 'tasks'))]).size).toBe(4);
      const stale = yield* refusalOf('ready_work', {
        limit: 2,
        cursor: scoped.next as string,
        scopeId: keysOf(rowsIn(scoped, 'tasks'))[0] as string,
      });
      expect(stale.code).toBe('cursor-stale');
      expect((yield* refusalOf('ready_work', { cursor: 'not-a-cursor' })).code).toBe('bad-cursor');
    }),
  );

  it.effect(
    'the standing friction answers the caller’s page, and a cursor of another read is refused',
    withGraphTools(function* () {
      const { graph, ctx, call } = yield* GraphTools;
      for (let at = 0; at < 5; at += 1) {
        const filed = yield* call('file_reflection', {
          title: `friction ${at}`,
          command: `command ${at}`,
          expected: `expected ${at}`,
          actual: `actual ${at}`,
        });
        expect(filed.status).toBe('ok');
      }
      const whole = yield* call('read_reflections', {});
      expect(rowsIn(whole, 'blocks')).toHaveLength(5);
      expect(whole.total).toBe(5);
      expect(whole.next).toBeNull();
      const first = yield* call('read_reflections', { limit: 2 });
      expect(rowsIn(first, 'blocks')).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(typeof first.next).toBe('string');
      const walked = yield* walk('read_reflections', {}, 'blocks', 2);
      expect(walked.pages).toBe(3);
      expect(walked.seen).toEqual(keysOf(rowsIn(whole, 'blocks')));
      expect(new Set(walked.seen).size).toBe(5);
      const root = (yield* graph.blocks.rootBlockOf(ctx.projectId)).id;
      for (let at = 0; at < 3; at += 1)
        yield* graph.blocks.create({ projectId: ctx.projectId, parentId: root, tags: ['task'], title: `elsewhere ${at}` });
      const other = yield* call('ready_work', { limit: 2 });
      expect(typeof other.next).toBe('string');
      expect((yield* refusalOf('read_reflections', { cursor: other.next as string })).code).toBe('cursor-stale');
    }),
  );

  it.effect(
    'a ranked search and a selected sort resume with their cursor alone',
    withGraphTools(function* () {
      const { demo, graph, ctx, call } = yield* GraphTools;
      const projectId = ctx.projectId;
      const root = (yield* graph.blocks.rootBlockOf(projectId)).id;
      const area = yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'lapis area' });
      for (let at = 0; at < 3; at += 1) yield* graph.blocks.create({ projectId, parentId: area.id, tags: ['idea'], title: `lapis ${at}` });
      const search = yield* call('search_blocks', { query: 'lapis', tag: 'idea', limit: 2 });
      const nextSearch = yield* call('search_blocks', { cursor: search.next as string, limit: 2 });
      expect(nextSearch.total).toBe(3);
      expect(new Set([...keysOf(rowsIn(search, 'blocks')), ...keysOf(rowsIn(nextSearch, 'blocks'))]).size).toBe(3);
      const query = yield* call('query_blocks', {
        tags: ['idea'],
        scope: [yield* demo.nameOf(area.id)],
        sort: { by: 'created', order: 'asc' },
        limit: 2,
      });
      const nextQuery = yield* call('query_blocks', { cursor: query.next as string, limit: 2 });
      expect(nextQuery.total).toBe(3);
      expect(nextQuery.sort).toEqual({ by: 'created', order: 'asc' });
      expect(new Set([...keysOf(rowsIn(query, 'blocks')), ...keysOf(rowsIn(nextQuery, 'blocks'))]).size).toBe(3);
      expect(
        (yield* refusalOf('query_blocks', { tags: ['task'], sort: { by: 'created', order: 'asc' }, cursor: query.next as string })).code,
      ).toBe('cursor-stale');
    }),
  );

  it.effect(
    'search and query cursors refuse a conflicting explicit project',
    withGraphTools(function* () {
      const { demo, graph, ctx, call } = yield* GraphTools;
      const projectId = ctx.projectId;
      const root = (yield* graph.blocks.rootBlockOf(projectId)).id;
      for (let at = 0; at < 2; at += 1) yield* graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: `claim ${at}` });
      const search = yield* call('search_blocks', { query: 'claim', tag: 'idea', limit: 1 });
      const query = yield* call('query_blocks', { tags: ['idea'], sort: { by: 'created', order: 'asc' }, limit: 1 });
      expect(typeof search.next).toBe('string');
      expect(typeof query.next).toBe('string');
      const otherRoot = yield* tempRootEffect(demo.fixture, 'tagma-other-');
      const other = yield* graph.projectLifecycle.create({ name: 'other-queues', rootPath: otherRoot });
      const context = {
        ...ctx,
        projectId: other.id,
        projectName: other.name,
        graphRoot: otherRoot,
        vocabulary: yield* graph.tags.reader(other.id),
      };
      expect((yield* refusalOf('search_blocks', { project: String(other.id), cursor: search.next as string }, context)).code).toBe(
        'place-mismatch',
      );
      expect((yield* refusalOf('query_blocks', { project: String(other.id), cursor: query.next as string }, context)).code).toBe(
        'place-mismatch',
      );
    }),
  );
});

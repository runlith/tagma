import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { Usage } from '@runlith/llm/schema/events';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import type { Cursor } from '@runlith/paging';
import type { ThreadContextReading } from '../thread/rows';
import { NATIVE_CAPABILITIES } from '../thread/record';
import type { ThreadContextLimit, ThreadLimitSubject } from '../thread/compaction/limit';
import { ThreadCacheCurve } from '../thread/cache/ThreadCacheCurve';
import type { ThreadCacheWarmth } from '../thread/cache/ThreadCacheWarmth';
import { type CollaborationConfig, type CollaborationWarmth, DeclaredCollaboration, type ThreadWarmthSubject } from './CollaborationConfig';
import { ThreadDirectory, threadDirectoryLayer } from './ThreadDirectory';
import { type ThreadDirectoryRow, Threads } from './threads';
const NOW = 13 * 60_000;
const unused = () => Effect.die('The directory only lists threads.');
const listedFrom = (rows: readonly ThreadDirectoryRow[], pageRows: number) =>
  Threads.of({
    list: (query) =>
      Effect.sync(() => {
        const from = query.cursor === undefined ? 0 : Number(query.cursor);
        const size = Math.min(pageRows, query.limit);
        const next = from + size;
        return { rows: rows.slice(from, next), total: rows.length, cursor: next < rows.length ? (String(next) as Cursor) : null };
      }),
    find: unused,
    named: unused,
    lineage: unused,
    watch: unused,
    readBirth: unused,
    create: unused,
  });
const row = (threadId: string, over: Partial<ThreadDirectoryRow> = {}): ThreadDirectoryRow => ({
  threadId,
  projectId: null,
  agentId: 'reviewer',
  typeId: 'reviewer',
  name: null,
  spawnRootId: 'root-1',
  parentThreadId: null,
  spawnedByRunId: null,
  movedAt: new Date(NOW),
  selection: null,
  provider: null,
  capabilities: NATIVE_CAPABILITIES,
  contextReading: null,
  run: null,
  assignment: over.run ? 'running' : 'completed',
  failureReason: null,
  failure: null,
  ...over,
});
describe('the warmth an entry carries', () => {
  const reading = (provider: string, model: string, reasoning?: string | null): ThreadContextReading => ({
    usage: new Usage({ inputTokens: 480_000, cacheReadInputTokens: 470_000 }),
    contextWindow: 1_000_000,
    runId: 'run-1',
    stepNumber: 3,
    provider,
    model,
    reasoning,
    measuredAt: new Date(NOW - 13 * 60_000).toISOString(),
    cache: { ttlSeconds: 3_600 },
    stale: false,
  });
  const opus = reading('subscription', 'claude-opus-5');
  const resting = { provider: 'subscription', model: 'claude-opus-5', reasoning: 'xhigh', account: null };
  const moved = { provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: null, account: 'work' };
  const rows = [
    row('thread-resting', { selection: resting, contextReading: opus }),
    row('thread-moved', { selection: moved, contextReading: opus }),
    row('thread-working', {
      selection: resting,
      contextReading: opus,
      run: { runId: 'run-9', life: 'working', askPrompt: null, since: new Date(NOW), stalledSince: null },
    }),
    row('thread-asking', {
      selection: resting,
      contextReading: opus,
      run: { runId: 'run-10', life: 'awaiting', askPrompt: 'Allow `git push --force`?', since: new Date(NOW), stalledSince: null },
    }),
    row('thread-collaborator'),
  ];
  const verdict = (state: ThreadCacheWarmth['state'], invalidatedBy: ThreadCacheWarmth['invalidatedBy']): ThreadCacheWarmth => ({
    state,
    heldTokens: 480_000,
    basis: 'promise',
    expiresAt: null,
    gap: null,
    warmShare: null,
    sample: null,
    oldestAt: null,
    invalidatedBy,
  });
  const entriesUnder = Effect.fnUntraced(function* (collaboration: Partial<CollaborationConfig>, listed = rows, limit = 20) {
    yield* TestClock.adjust(NOW);
    const built = yield* Layer.build(
      threadDirectoryLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Threads, listedFrom(listed, listed.length)),
            Layer.succeed(DeclaredCollaboration, {
              models: () => modelCatalog([]),
              subAgentDepth: unused,
              delegation: unused,
              reconcileIntervalMs: 1_000,
              ...collaboration,
            }),
            Layer.succeed(ThreadCacheCurve, {
              of: (providers) => Effect.succeed(providers.map((provider) => ({ provider, buckets: [] }))),
            }),
          ),
        ),
      ),
    );
    const directory = Context.get(built, ThreadDirectory);
    return (yield* directory.access({ id: 'thread-reader', principal: 'owner-1' }).list({ limit })).rows;
  });
  it.effect(
    'a resting entry carries the next-request verdict; a thread a run holds is never judged',
    Effect.fnUntraced(function* () {
      const asked: (readonly ThreadWarmthSubject[])[] = [];
      const warmth: CollaborationWarmth = (subjects) => {
        asked.push(subjects);
        return Effect.succeed(
          subjects.map((subject) => (subject.provider === 'openai-oauth' ? verdict('cold', 'selection') : verdict('warm', null))),
        );
      };
      const entries = yield* entriesUnder({ warmth });
      const warmthOf = (threadId: string) => entries.find((entry) => entry.threadId === threadId)!.warmth;
      expect(asked).toEqual([
        [
          { contextReading: opus, ...resting },
          { contextReading: opus, ...moved },
        ],
      ]);
      expect(warmthOf('thread-resting')).toEqual(verdict('warm', null));
      expect(warmthOf('thread-moved')).toEqual(verdict('cold', 'selection'));
      expect(warmthOf('thread-working')).toBeNull();
      expect(warmthOf('thread-asking')).toBeNull();
      expect(warmthOf('thread-collaborator')).toBeNull();
      const asking = entries.find((entry) => entry.threadId === 'thread-asking')!;
      expect(asking.life).toBe('awaiting');
      expect(asking.askPrompt).toBe('Allow `git push --force`?');
      expect(entries.find((entry) => entry.threadId === 'thread-working')!.askPrompt).toBeNull();
    }),
  );
  it.effect(
    'warmth is evaluated only for the page the reader requested',
    Effect.fnUntraced(function* () {
      const judged: ThreadWarmthSubject[] = [];
      const entries = yield* entriesUnder(
        {
          warmth: (subjects) => {
            judged.push(...subjects);
            return Effect.succeed(subjects.map(() => verdict('warm', null)));
          },
        },
        rows,
        1,
      );
      expect(entries.map((entry) => [entry.threadId, entry.warmth?.state])).toEqual([['thread-resting', 'warm']]);
      expect(judged).toEqual([{ contextReading: opus, ...resting }]);
    }),
  );
  it.effect(
    'an entry carries the limit its project answers, a thread on the default model included, and the window apart',
    Effect.fnUntraced(function* () {
      const point: ThreadContextLimit = {
        window: 1_000_000,
        compaction: { at: 550_000, strategy: 'percent', share: 0.55, source: 'override' },
      };
      const asked: (readonly ThreadLimitSubject[])[] = [];
      const listed = [
        row('thread-default', { agentId: 'tagma', typeId: 'reader', projectId: 7, provider: 'subscription', contextReading: opus }),
        row('thread-homeless', { provider: 'subscription', contextReading: opus }),
      ];
      const answered = yield* entriesUnder(
        {
          limits: (subjects) => {
            asked.push(subjects);
            return Effect.succeed(new Map(subjects.map((subject) => [subject.id, point] as const)));
          },
        },
        listed,
      );
      expect(asked.map((subjects) => subjects.map((subject) => [subject.id, subject.agentId, subject.model]))).toEqual([
        [['thread-default', 'tagma', null]],
      ]);
      expect(answered[0]!.agentId).toBe('reader');
      expect(answered.map((entry) => [entry.threadId, entry.context?.limit ?? null, entry.context?.window])).toEqual([
        ['thread-default', point, 1_000_000],
        ['thread-homeless', null, 1_000_000],
      ]);
      expect(answered[0]!.context?.tokens).toBe(480_000);
    }),
  );
  it.effect(
    'without a warmth port the catalog judges the request each thread would send next',
    Effect.fnUntraced(function* () {
      const models = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
      const option = models.resolveTextModel('subscription', null);
      const [sent, other] = option.reasoningOptions.map((rung) => rung.id);
      if (sent === undefined || other === undefined) return yield* Effect.die('The model needs two reasoning rungs.');
      const signed = reading('subscription', option.id, sent);
      const entries = yield* entriesUnder({ models: () => models }, [
        row('thread-kept', {
          selection: { provider: 'subscription', model: option.id, reasoning: sent, account: null },
          contextReading: signed,
        }),
        row('thread-moved', {
          selection: { provider: 'subscription', model: option.id, reasoning: other, account: null },
          contextReading: signed,
        }),
      ]);
      expect(entries.map((entry) => [entry.threadId, entry.warmth?.state, entry.warmth?.invalidatedBy])).toEqual([
        ['thread-kept', 'warm', null],
        ['thread-moved', 'cold', 'reasoning'],
      ]);
    }),
  );
});
it.effect(
  'a page carries its total, continuation, life and stall as reported by the harness',
  Effect.fnUntraced(function* () {
    const stalled = new Date(NOW - 99 * 60_000);
    const rows = [
      row('thread-parked', { run: { runId: 'run-1', life: 'working', askPrompt: null, since: stalled, stalledSince: stalled } }),
      row('thread-asking', { run: { runId: 'run-2', life: 'awaiting', askPrompt: 'Allow?', since: stalled, stalledSince: null } }),
      row('thread-healthy', { run: { runId: 'run-3', life: 'working', askPrompt: null, since: new Date(NOW), stalledSince: null } }),
      row('thread-resting'),
    ];
    const built = yield* Layer.build(
      threadDirectoryLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Threads, listedFrom(rows, 3)),
            Layer.succeed(DeclaredCollaboration, null),
            Layer.succeed(ThreadCacheCurve, { of: () => Effect.succeed([]) }),
          ),
        ),
      ),
    );
    const access = Context.get(built, ThreadDirectory).access({ id: 'thread-reader', principal: 'owner-1' });
    const first = yield* access.list({ limit: 3 });
    const second = yield* access.list({ limit: 3, cursor: first.cursor! });
    const pages = [first, second];
    expect(pages.map((page) => [page.rows.length, page.total, page.cursor])).toEqual([
      [3, 4, '3' as Cursor],
      [1, 4, null],
    ]);
    expect(pages.flatMap((page) => page.rows).map((entry) => [entry.threadId, entry.life, entry.stalledSince])).toEqual([
      ['thread-parked', 'working', stalled.toISOString()],
      ['thread-asking', 'awaiting', null],
      ['thread-healthy', 'working', null],
      ['thread-resting', 'idle', null],
    ]);
  }),
);

import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import type { ThreadEventBody } from '@runlith/agent/thread/events';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { ToolAnswer, toolExecute } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers.js';
import { graphFixture, type EffectDemo } from '../graphFixture.js';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { project } from '../../../projects/testing/doubles.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { evidenceReads } from '../../../native-harness/testing/doubles.js';
import { sessionFor } from '../../../external-harnesses/testing/sessions.js';
import { acpTestSeat } from '../../../external-harnesses/testing/seats.js';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import {
  compressRollout,
  conversationBackfill,
  conversationReads,
  evictThreadProjection,
  exportThreadRollout,
  rehydrateThreadRecords,
  restedReads,
  sqliteThreadJournal,
  threadEvent,
  threadProjection,
} from '../../../threads/testing/doubles.js';
import { Conversations, type ConversationSearch } from '../../../threads/contract/service/conversations.js';
import { EvidenceReads, type EvidenceReader } from '../../../threads/contract/service/evidence.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { SEARCH_OPERATIONS } from '../../../threads/contract/wire/operations/search.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { ENTRY_KINDS } from '../../manifest.js';

const born = new Date('2026-10-01T08:00:00.000Z');
const operator: EvidenceReader = { kind: 'operator' };
type ConversationProjects = { readonly here: number; readonly there: number };

const setup = Effect.fnUntraced(function* (projects: ConversationProjects) {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'conversations-' });
  const context = yield* Effect.context<MachineStore | MachineUnits | ThreadRecords | ThreadEntryKinds>();
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const evidence = yield* Effect.provide(evidenceReads(join(home, 'reads')), context);
  const reads = yield* conversationReads().pipe(Effect.provideService(EvidenceReads, evidence), Effect.provide(context));
  const log = yield* Effect.provide(sqliteThreadJournal(), context);
  return { files, home, context, db, units, reads, log, records, projects, sequence: { event: 0 } };
});
class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/ConversationsWorld') {}
class ToolGraph extends Context.Service<ToolGraph, EffectDemo>()('testing/ConversationToolGraph') {}
const thread = Effect.fn('testing.conversationThread')(function* (id: string, projectId: number, title = id) {
  const { db } = yield* World;
  yield* bornThread(
    db,
    {
      id,
      ownerId: 'owner',
      agentId: 'tagma',
      authority: { mode: 'trust', bypassFrom: null },
      profile: null,
      spawnRootId: id,
      cacheGroup: id,
      provider: 'openai-oauth',
      status: 'idle',
      createdAt: born,
      updatedAt: born,
    },
    { projectId, title },
  );
});
type Said = {
  readonly id: string;
  readonly role?: 'user' | 'assistant';
  readonly text: string;
  readonly at: string;
  readonly runId?: string;
};
const message = (said: Said): ThreadEventBody => ({
  kind: 'message',
  payload: {
    entry: { type: 'message', id: said.id, role: said.role ?? 'user', text: said.text, occurredAt: said.at, runId: said.runId ?? 'run-1' },
  },
});
const append = Effect.fn('testing.conversationAppend')(function* (threadId: string, ...events: readonly ThreadEventBody[]) {
  const { units, log, sequence } = yield* World;
  yield* units.write('test.append', (unit) =>
    Effect.forEach(events, (event) => log.append({ threadId, id: `event-${++sequence.event}`, ...event }, unit), { discard: true }),
  );
});
const search = Effect.fnUntraced(function* (
  input: Partial<ConversationSearch> & { readonly query: string },
  reader: EvidenceReader = operator,
) {
  const { reads } = yield* World;
  return yield* reads.search(reader, { scope: { kind: 'all', removed: [] }, limit: 3, ...input });
});
const matchesOf = Effect.fnUntraced(function* (threadId: string, query: string) {
  return (yield* search({ query, threadId })).matches.map((hit) => hit.match.entryId);
});
const registered = Effect.fnUntraced(function* (name: string) {
  const { db, units } = yield* World;
  const row = yield* db
    .insert(project())
    .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt: born })
    .returning()
    .get();
  if (row === undefined) return yield* Effect.die(new Error('the fixture project was not inserted'));
  yield* Effect.addFinalizer(() =>
    units
      .write('testing.conversationProjectRelease', (unit) => unit.run(db.delete(project()).where(eq(project().id, row.id))))
      .pipe(Effect.orDie),
  );
  return row.id;
});
const journal = Effect.fnUntraced(function* () {
  const { home, context } = yield* World;
  return yield* Effect.flatMap(restedReads(ENTRY_KINDS, home), sqliteThreadJournal).pipe(Effect.provide(context));
});
const backfilled = Effect.fn('testing.backfillConversations')(function* () {
  const { context } = yield* World;
  const backfill = yield* conversationBackfill(yield* journal()).pipe(Effect.provide(context));
  yield* backfill.run();
});
const rested = Effect.fn('testing.restConversation')(function* (
  threadId: string,
  projectId: number,
  ...events: readonly ThreadEventBody[]
) {
  const { home, files, context } = yield* World;
  yield* thread(threadId, projectId);
  yield* append(threadId, ...events);
  const path = join(home, String(projectId), `${threadId}.jsonl`);
  yield* files.makeDirectory(join(home, String(projectId)), { recursive: true });
  yield* exportThreadRollout({ threadId, path, parts: nativeOnlyParts }).pipe(Effect.provide(context));
  yield* Effect.flatMap(threadProjection(ENTRY_KINDS), (projection) => projection.run({ threadId, path })).pipe(Effect.provide(context));
  expect(yield* evictThreadProjection({ threadId, path, parts: nativeOnlyParts }).pipe(Effect.provide(context))).toMatchObject({
    outcome: 'evicted',
  });
  return path;
});
const forget = Effect.fn('testing.forgetConversationIndex')(function* (threadId: string) {
  const { db } = yield* World;
  yield* db.run(sql`delete from thread_message where thread_id = ${threadId}`);
  yield* db.run(sql`delete from thread_conversation where thread_id = ${threadId}`);
});

const fixture = Layer.effect(
  World,
  Effect.gen(function* () {
    const here = yield* threadStoreFixture;
    const there = yield* threadStoreFixture;
    return yield* setup({ here: here.projectId, there: there.projectId }).pipe(
      Effect.provide(Context.add(here.context, ThreadEntryKinds, ENTRY_KINDS)),
    );
  }),
).pipe(Layer.provide(BunFileSystem.layer));

const toolFixture = Layer.effectContext(
  Effect.gen(function* () {
    const lifetime = graphFixture({ projects: ['here', 'there'] });
    const { effects: demo } = yield* Effect.acquireRelease(lifetime.openEffect(), () => lifetime.releaseEffect.pipe(Effect.orDie));
    const records = yield* Effect.provide(makeThreadRecords, demo.context);
    const context = Context.add(demo.context, ThreadEntryKinds, ENTRY_KINDS).pipe(Context.add(ThreadRecords, records));
    const world = yield* setup({ here: demo.project('here').id, there: demo.project('there').id }).pipe(Effect.provide(context));
    return Context.make(World, world).pipe(Context.add(ToolGraph, demo));
  }),
).pipe(Layer.provide(BunFileSystem.layer));

describe('conversation index and journal', () => {
  it.live('word forms, Unicode and scope find only spoken messages and reader steering, never private or keep-warm text', () =>
    Effect.gen(function* () {
      const { projects } = yield* World;
      yield* thread('t-said', projects.there, 'zany-otter');
      yield* append(
        't-said',
        message({ id: 'm-1', text: 'Привет', at: '2026-10-02T09:00:00.000Z' }),
        message({ id: 'm-2', text: 'поедем в Черногорию на неделе', at: '2026-10-02T09:01:00.000Z' }),
        message({
          id: 'm-3',
          role: 'assistant',
          text: 'I booked two trips, café included: 黑山旅游怎么样',
          at: '2026-10-02T09:02:00.000Z',
        }),
        {
          kind: 'tool',
          payload: {
            entry: {
              type: 'tool',
              id: 'tool-1',
              toolName: 'read',
              toolCallId: 'c-1',
              toolState: 'output-available',
              toolOutput: 'Черногория',
              occurredAt: '2026-10-02T09:03:00.000Z',
            },
          },
        },
        {
          kind: 'reasoning',
          payload: {
            entry: { type: 'reasoning', id: 'why-1', text: 'Черногория', state: 'done', occurredAt: '2026-10-02T09:03:30.000Z' },
          },
        },
        {
          kind: 'signal',
          payload: {
            entry: {
              type: 'signal',
              id: 'sig-1',
              signalType: 'report',
              addressee: 'reader',
              text: 'Черногория',
              occurredAt: '2026-10-02T09:04:00.000Z',
            },
          },
        },
        {
          kind: 'signal',
          payload: {
            entry: {
              type: 'signal',
              id: 'warm-1',
              runId: 'run-warm',
              signalType: 'keep-warm',
              addressee: 'transport',
              text: 'answer ok',
              occurredAt: '2026-10-02T09:05:00.000Z',
            },
          },
        },
        message({ id: 'm-warm', role: 'assistant', text: 'Черногория ok', at: '2026-10-02T09:05:10.000Z', runId: 'run-warm' }),
        message({ id: 'm-4', text: 'а теперь про базу данных', at: '2026-10-02T09:06:00.000Z' }),
        {
          kind: 'signal',
          payload: {
            entry: {
              type: 'signal',
              id: 'steer-1',
              runId: 'run-1',
              signalType: 'user-message',
              addressee: 'reader',
              text: 'и ещё заедем в Котор',
              occurredAt: '2026-10-02T09:07:00.000Z',
            },
          },
        },
      );
      const found = yield* search({
        query: 'Черногория',
        since: Date.parse('2026-10-02T00:00:00Z'),
        before: Date.parse('2026-10-03T00:00:00Z'),
      });
      expect(
        found.matches.map((hit) => [hit.threadId, hit.project?.id, hit.title, hit.match.entryId, hit.match.role, hit.match.occurredAt]),
      ).toEqual([['t-said', projects.there, 'zany-otter', 'm-2', 'operator', '2026-10-02T09:01:00.000Z']]);
      expect(found.matches[0]?.match.snippet).toBe('поедем в Черногорию на неделе');
      expect(found.coverage).toEqual({ complete: true, unindexed: 0 });
      expect(found.tally).toEqual({ total: 1 });
      for (const query of ['trip', 'trips', 'cafe', '黑山', '旅游']) expect(yield* matchesOf('t-said', query)).toEqual(['m-3']);
      expect((yield* search({ query: 'Котор', threadId: 't-said' })).matches.map((hit) => [hit.match.entryId, hit.match.role])).toEqual([
        ['steer-1', 'operator'],
      ]);
      expect((yield* search({ query: 'Черногория', scope: { kind: 'projects', ids: [projects.here] } })).matches).toEqual([]);
      expect((yield* search({ query: 'Черногория', before: Date.parse('2026-10-02T00:00:00Z') })).matches).toEqual([]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('short words alone refuse and can narrow a longer query', () =>
    Effect.gen(function* () {
      const { projects, reads } = yield* World;
      yield* thread('t-short', projects.here);
      yield* append(
        't-short',
        message({ id: 's-1', text: 'the AI plan for Lisbon', at: '2026-09-01T10:00:00.000Z' }),
        message({ id: 's-2', text: 'Lisbon without it', at: '2026-09-01T10:01:00.000Z' }),
      );
      expect(yield* Effect.flip(reads.search(operator, { query: 'AI', scope: { kind: 'all', removed: [] }, limit: 1 }))).toMatchObject({
        code: 'query-too-short',
      });
      const narrowed = yield* search({ query: 'Lisbon ai', threadId: 't-short' });
      expect([narrowed.matches.map((hit) => hit.match.entryId), narrowed.tally]).toEqual([['s-1'], { total: 1 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a word typed with a typo finds what was said when nothing matches as written, and the answer says it is approximate', () =>
    Effect.gen(function* () {
      const { projects } = yield* World;
      yield* thread('t-typo', projects.here);
      yield* append('t-typo', message({ id: 'k-1', text: 'the kaleidoscope review is done', at: '2026-08-01T10:00:00.000Z' }));
      const near = yield* search({ query: 'kaleidoscpoe' });
      expect([near.matches.map((hit) => hit.match.entryId), near.approximate, near.tally]).toEqual([['k-1'], true, { total: 1 }]);
      expect((yield* search({ query: 'kaleidoscope' })).approximate).toBe(false);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('withdrawal removes a run and replacing a message moves its indexed time', () =>
    Effect.gen(function* () {
      const { projects } = yield* World;
      yield* thread('t-moved', projects.here);
      yield* append(
        't-moved',
        message({ id: 'w-1', text: 'Valparaiso first', at: '2026-09-05T10:00:00.000Z', runId: 'run-a' }),
        message({ id: 'w-2', text: 'Valparaiso again', at: '2026-09-05T10:01:00.000Z', runId: 'run-b' }),
        { kind: 'withdrawal', payload: { withdrawn: { runId: 'run-b', keepMessages: 0 } } },
        message({ id: 'w-1', text: 'Valparaiso, said later', at: '2026-09-06T10:00:00.000Z', runId: 'run-a' }),
      );
      expect(
        (yield* search({ query: 'Valparaiso', threadId: 't-moved' })).matches.map((hit) => [
          hit.match.entryId,
          hit.match.occurredAt,
          hit.match.snippet,
        ]),
      ).toEqual([['w-1', '2026-09-06T10:00:00.000Z', 'Valparaiso, said later']]);
      expect((yield* search({ query: 'Valparaiso', before: Date.parse('2026-09-06T00:00:00Z') })).matches).toEqual([]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live(
    'equal timestamps and shared message keys page distinct threads without repetition, and changing the query invalidates its cursor',
    () =>
      Effect.gen(function* () {
        const { projects, reads } = yield* World;
        const at = '2026-09-10T12:00:00.000Z';
        for (const id of ['t-fork-a', 't-fork-b', 't-fork-c']) yield* thread(id, projects.here);
        yield* append(
          't-fork-a',
          message({ id: 'f-1', text: 'Reykjavik plan', at }),
          message({ id: 'f-2', text: 'Reykjavik again', at: '2026-09-10T12:05:00.000Z' }),
        );
        yield* append('t-fork-b', message({ id: 'f-1', text: 'Reykjavik plan', at }));
        yield* append('t-fork-c', message({ id: 'f-3', text: 'Reykjavik later', at: '2026-09-10T12:10:00.000Z' }));
        const first = yield* search({ query: 'Reykjavik', limit: 2 });
        const second = yield* search({ query: 'Reykjavik', limit: 2, cursor: first.cursor ?? undefined });
        expect([...first.matches, ...second.matches].map((hit) => hit.threadId)).toEqual(['t-fork-c', 't-fork-a', 't-fork-b']);
        expect(second.cursor).toBeNull();
        expect(first.tally).toEqual({ total: 3 });
        expect(yield* matchesOf('t-fork-b', 'Reykjavik')).toEqual(['f-1']);
        expect(
          yield* Effect.flip(
            reads.search(operator, { query: 'Lisbon', scope: { kind: 'all', removed: [] }, limit: 2, cursor: first.cursor ?? '' }),
          ),
        ).toMatchObject({ code: 'cursor-stale' });
      }).pipe(Effect.provide(fixture)),
  );
  it.live('the caller is excluded unless named and removing its record removes its indexed words', () =>
    Effect.gen(function* () {
      const { projects, records, units, db } = yield* World;
      yield* thread('t-self', projects.here);
      yield* append('t-self', message({ id: 'o-1', text: 'Tbilisi questions', at: '2026-09-11T10:00:00.000Z' }));
      const own = yield* search({ query: 'Tbilisi' }, { kind: 'thread', threadId: 't-self' });
      expect([own.matches, own.excluded]).toEqual([[], 't-self']);
      expect((yield* search({ query: 'Tbilisi', threadId: 't-self' }, { kind: 'thread', threadId: 't-self' })).matches).toHaveLength(1);
      yield* units.write('test.deleteConversation', (unit) => records.remove(unit, ['t-self']));
      expect((yield* search({ query: 'Tbilisi' })).matches).toEqual([]);
      expect(yield* db.all(sql`select rowid from thread_message_fts where thread_message_fts.text match ${'"tbilisi"'}`)).toEqual([]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a conversation window skips tool records and refuses a thread belonging to another project', () =>
    Effect.gen(function* () {
      const { projects, reads } = yield* World;
      yield* thread('t-window', projects.there);
      yield* append(
        't-window',
        message({ id: 'n-1', text: 'before it', at: '2026-09-12T10:00:00.000Z' }),
        {
          kind: 'tool',
          payload: {
            entry: {
              type: 'tool',
              id: 'tool-n',
              toolName: 'read',
              toolCallId: 'c-n',
              toolState: 'output-available',
              occurredAt: '2026-09-12T10:00:30.000Z',
            },
          },
        },
        message({ id: 'n-2', role: 'assistant', text: 'Kotor at last', at: '2026-09-12T10:01:00.000Z' }),
        message({ id: 'n-3', text: 'after it', at: '2026-09-12T10:02:00.000Z' }),
      );
      expect(
        (yield* reads.window(projects.there, { addresses: [{ threadId: 't-window', at: 'n-2' }], around: 1 })).map((window) =>
          'messages' in window ? window.messages.map((said) => said.entryId) : window.missing,
        ),
      ).toEqual([['n-1', 'n-2', 'n-3']]);
      expect(
        yield* Effect.flip(reads.window(projects.here, { addresses: [{ threadId: 't-window', at: 'n-2' }], around: 1 })),
      ).toMatchObject({ reason: 'other-project', threadId: 't-window', projectId: projects.there });
    }).pipe(Effect.provide(fixture)),
  );
  it.live('harness journal indexing is independent of transport and closes coverage when no words were said', () =>
    Effect.gen(function* () {
      const { db } = yield* World;
      const own = yield* registered('harnesses');
      for (const id of ['t-acp', 't-screen']) yield* thread(id, own);
      const seat = acpTestSeat('claude-code', 'tagma', undefined);
      yield* sessionFor(db, 't-acp', seat.facet, seat.kernel);
      yield* sessionFor(db, 't-screen', harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))));
      yield* append('t-acp', message({ id: 'h-1', text: 'Ostrog monastery', at: '2026-09-13T10:00:00.000Z' }));
      yield* append('t-screen', {
        kind: 'reasoning',
        payload: { entry: { type: 'reasoning', id: 'h-2', text: 'Ostrog', state: 'done', occurredAt: '2026-09-13T10:01:00.000Z' } },
      });
      const found = yield* search({ query: 'Ostrog', scope: { kind: 'projects', ids: [own] } });
      expect([found.matches.map((hit) => hit.threadId), found.coverage]).toEqual([['t-acp'], { complete: true, unindexed: 0 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('an agent opens the cross-project match returned by its search tool as a neighbouring conversation window', () =>
    Effect.gen(function* () {
      const { projects, reads, records, context } = yield* World;
      const demo = yield* ToolGraph;
      yield* thread('t-door', projects.there, 'quiet-heron');
      yield* append(
        't-door',
        message({ id: 'd-1', text: 'before the trip', at: '2026-09-15T10:00:00.000Z' }),
        message({ id: 'd-2', text: 'поедем в Черногорию осенью', at: '2026-09-15T10:01:00.000Z' }),
        message({ id: 'd-3', role: 'assistant', text: 'after the trip', at: '2026-09-15T10:02:00.000Z' }),
      );
      const root = demo.project('here').root;
      const tools = yield* fixtureNativeCatalog(
        {
          place: { root, origin: null },
          caller: {
            actor: {
              kind: 'thread',
              threadId: 't-agent',
              projectId: projects.here,
              principalId: 'owner',
              session: { harness: 'tagma', key: 't-agent' },
            },
            files: { path: root, resolve: (candidate) => join(root, candidate) },
          },
          project: { id: projects.here, name: 'here' },
          vocabulary: yield* demo.graph.tags.reader(projects.here),
          identity: sessionIdentity,
          world: 'checkout',
          graphRoot: root,
          owners: Context.merge(demo.context, context).pipe(Context.add(Conversations, reads), Context.add(ThreadRecords, records)),
        },
        ['search_threads', 'read_thread_record'],
      );
      const called = Effect.fn('testing.conversationTool')(function* (name: string, input: Record<string, unknown>) {
        const tool = tools[name];
        const execute = tool === undefined ? null : toolExecute(tool);
        if (tool === undefined || execute === null) return yield* Effect.die(new Error(`the conversation tool ${name} is absent`));
        const answered = yield* execute(input, { toolCallId: `call-${name}`, caller: unthreadedCaller, messages: [] });
        const value = answered instanceof ToolAnswer ? answered.value : answered;
        return { value, said: answered instanceof ToolAnswer ? (answered.text ?? '') : '' };
      });
      const found = yield* called('search_threads', { query: 'Черногория', projects: 'all', limit: 3 });
      expect(yield* Schema.decodeUnknownEffect(knownAnswer(SEARCH_OPERATIONS.search_threads.answer))(found.value)).toMatchObject({
        matches: expect.arrayContaining([
          expect.objectContaining({ threadId: 't-door', match: expect.objectContaining({ entryId: 'd-2' }) }),
        ]),
      });
      expect(found.said).toContain('t-door');
      expect(found.said).toContain('d-2');
      const opened = yield* called('read_thread_record', {
        project: String(projects.there),
        threadId: 't-door',
        at: [{ at: 'd-2' }],
        conversation: true,
        around: 1,
      });
      const decoded = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread_record.answer))(opened.value);
      if (!('windows' in decoded)) return yield* Effect.die(new Error('the match did not open as a conversation window'));
      expect(
        decoded.windows.map((window) => ('messages' in window ? window.messages.map((said) => [said.entryId, said.at]) : window)),
      ).toEqual([
        [
          ['d-1', 1],
          ['d-2', 2],
          ['d-3', 3],
        ],
      ]);
      for (const id of ['d-1', 'd-2', 'd-3']) expect(opened.said).toContain(id);
    }).pipe(Effect.provide(toolFixture)),
  );
  it.live('rested threads remain searchable without duplicate index writes on rehydrate', () =>
    Effect.gen(function* () {
      const { projects, context, db } = yield* World;
      const path = yield* rested(
        't-rested',
        projects.there,
        message({ id: 'r-1', text: 'поедем в Черногорию', at: '2026-09-20T10:00:00.000Z' }),
        message({ id: 'r-2', role: 'assistant', text: 'other things now', at: '2026-09-20T10:01:00.000Z' }),
      );
      expect(yield* matchesOf('t-rested', 'Черногория')).toEqual(['r-1']);
      yield* rehydrateThreadRecords({ threadId: 't-rested', path, parts: nativeOnlyParts }).pipe(Effect.provide(context));
      expect(yield* matchesOf('t-rested', 'Черногория')).toEqual(['r-1']);
      expect(yield* db.all(sql`select entry_id from thread_message where thread_id = ${'t-rested'} order by position`)).toEqual([
        { entry_id: 'r-1' },
        { entry_id: 'r-2' },
      ]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('backfill preserves the order of old events and a newer live withdrawal', () =>
    Effect.gen(function* () {
      const { db } = yield* World;
      const own = yield* registered('before');
      yield* thread('t-before', own);
      yield* db.insert(threadEvent()).values([
        {
          threadId: 't-before',
          position: 1,
          id: 'b-e1',
          kind: 'message',
          payload: message({ id: 'b-1', text: 'Montenegro trips', at: '2026-09-25T10:00:00.000Z', runId: 'run-x' }).payload,
        },
        {
          threadId: 't-before',
          position: 2,
          id: 'b-e2',
          kind: 'message',
          payload: message({ id: 'b-2', text: 'Montenegro again', at: '2026-09-25T10:01:00.000Z', runId: 'run-y' }).payload,
        },
      ]);
      yield* append('t-before', { kind: 'withdrawal', payload: { withdrawn: { runId: 'run-y', keepMessages: 0 } } });
      const waiting = yield* search({ query: 'Montenegro', scope: { kind: 'projects', ids: [own] } });
      expect([waiting.matches, waiting.coverage]).toEqual([[], { complete: false, unindexed: 1 }]);
      yield* backfilled();
      const filled = yield* search({ query: 'Montenegro', scope: { kind: 'projects', ids: [own] } });
      expect([filled.matches.map((hit) => hit.match.entryId), filled.coverage]).toEqual([['b-1'], { complete: true, unindexed: 0 }]);
      expect(yield* db.select().from(threadEvent()).where(eq(threadEvent().threadId, 't-before'))).toHaveLength(3);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('backfill reads an evicted journal from compression without reopening its rows or unpacking its file', () =>
    Effect.gen(function* () {
      const { files, db, context } = yield* World;
      const own = yield* registered('installed');
      const path = yield* rested('t-installed', own, message({ id: 'i-1', text: 'Budva by the sea', at: '2026-09-26T10:00:00.000Z' }));
      yield* compressRollout(path).pipe(Effect.provide(context));
      yield* forget('t-installed');
      expect((yield* search({ query: 'Budva', scope: { kind: 'projects', ids: [own] } })).coverage).toEqual({
        complete: false,
        unindexed: 1,
      });
      yield* backfilled();
      const filled = yield* search({ query: 'Budva', scope: { kind: 'projects', ids: [own] } });
      expect([filled.matches.map((hit) => hit.match.entryId), filled.coverage]).toEqual([['i-1'], { complete: true, unindexed: 0 }]);
      expect([yield* files.exists(path), yield* files.exists(`${path}.zst`)]).toEqual([false, true]);
      expect(yield* db.select().from(threadEvent()).where(eq(threadEvent().threadId, 't-installed'))).toEqual([]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a rest mark makes the file authoritative and rehydrate appends a database-only suffix after its prefix', () =>
    Effect.gen(function* () {
      const { db, context, files } = yield* World;
      const own = yield* registered('prefix');
      const path = yield* rested('t-prefix', own, message({ id: 'p-1', text: 'Herceg Novi first', at: '2026-09-27T10:00:00.000Z' }));
      yield* db.insert(threadEvent()).values({
        threadId: 't-prefix',
        position: 1,
        id: 'p-e2',
        kind: 'message',
        payload: message({ id: 'p-2', role: 'assistant', text: 'Herceg Novi then', at: '2026-09-27T10:05:00.000Z' }).payload,
      });
      const window = { head: Number.MAX_SAFE_INTEGER, afterPosition: 0, limit: 3, kinds: ['message'] };
      const before = (yield* (yield* journal()).recordsAsOf('t-prefix', window)).map((row) => row.id);
      expect(before).not.toContain('p-e2');
      expect(before).toHaveLength(1);
      yield* rehydrateThreadRecords({ threadId: 't-prefix', path, parts: nativeOnlyParts }).pipe(Effect.provide(context));
      expect((yield* (yield* journal()).recordsAsOf('t-prefix', window)).map((row) => [row.position, row.id])).toEqual([
        [1, before[0]!],
        [2, 'p-e2'],
      ]);
      expect(yield* files.readFileString(path)).toContain('"id":"p-e2"');
    }).pipe(Effect.provide(fixture)),
  );
  it.live('missing and broken files keep coverage open until a repaired file is indexed', () =>
    Effect.gen(function* () {
      const { files } = yield* World;
      const own = yield* registered('broken');
      const missing = yield* rested('t-missing', own, message({ id: 'x-1', text: 'Ulcinj notes', at: '2026-09-28T10:00:00.000Z' }));
      const broken = yield* rested('t-broken', own, message({ id: 'y-1', text: 'Ulcinj again', at: '2026-09-28T11:00:00.000Z' }));
      const kept = yield* files.readFile(missing);
      yield* files.remove(missing);
      yield* files.writeFileString(broken, '{"kind":"event","row":\n', { flag: 'a' });
      yield* forget('t-missing');
      yield* forget('t-broken');
      yield* backfilled();
      expect((yield* search({ query: 'Ulcinj', scope: { kind: 'projects', ids: [own] } })).coverage).toEqual({
        complete: false,
        unindexed: 2,
      });
      yield* files.writeFile(missing, kept);
      yield* backfilled();
      const repaired = yield* search({ query: 'Ulcinj', scope: { kind: 'projects', ids: [own] } });
      expect([repaired.matches.map((hit) => hit.threadId), repaired.coverage]).toEqual([['t-missing'], { complete: false, unindexed: 1 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a truncated rollout indexes its surviving prefix without claiming complete coverage', () =>
    Effect.gen(function* () {
      const { files } = yield* World;
      const own = yield* registered('cut');
      const path = yield* rested(
        't-cut',
        own,
        message({ id: 'c-1', text: 'Sveti Stefan first', at: '2026-09-29T10:00:00.000Z' }),
        message({ id: 'c-2', text: 'Sveti Stefan second', at: '2026-09-29T10:01:00.000Z' }),
      );
      const lines = (yield* files.readFileString(path)).split('\n');
      yield* files.writeFileString(
        path,
        `${lines
          .slice(
            0,
            lines.findIndex((line) => line.includes('"position":2')),
          )
          .join('\n')}\n`,
      );
      yield* forget('t-cut');
      yield* backfilled();
      const cut = yield* search({ query: 'Stefan', scope: { kind: 'projects', ids: [own] } });
      expect([cut.matches.map((hit) => hit.match.entryId), cut.coverage]).toEqual([['c-1'], { complete: false, unindexed: 1 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a headless rollout is not accepted as whole history', () =>
    Effect.gen(function* () {
      const { files, db } = yield* World;
      const own = yield* registered('headless');
      const path = yield* rested(
        't-headless',
        own,
        message({ id: 'h-1', text: 'Tivat first', at: '2026-09-29T12:00:00.000Z' }),
        message({ id: 'h-2', text: 'Tivat second', at: '2026-09-29T12:01:00.000Z' }),
      );
      yield* db.insert(threadEvent()).values({
        threadId: 't-headless',
        position: 2,
        id: 'h-e2',
        kind: 'message',
        payload: message({ id: 'h-2', text: 'Tivat second', at: '2026-09-29T12:01:00.000Z' }).payload,
      });
      yield* files.writeFileString(
        path,
        (yield* files.readFileString(path))
          .split('\n')
          .filter((line) => !line.includes('"position":1,'))
          .join('\n'),
      );
      yield* forget('t-headless');
      expect(
        (yield* Effect.exit((yield* journal()).recordsAsOf('t-headless', { head: 3, afterPosition: 0, limit: 3, kinds: ['message'] })))
          ._tag,
      ).toBe('Failure');
      yield* backfilled();
      const headless = yield* search({ query: 'Tivat', scope: { kind: 'projects', ids: [own] } });
      expect([headless.matches.map((hit) => hit.match.entryId), headless.coverage]).toEqual([[], { complete: false, unindexed: 1 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a newer known message keeps a backfill incomplete until its event arrives', () =>
    Effect.gen(function* () {
      const { db } = yield* World;
      const own = yield* registered('racing');
      yield* thread('t-racing', own);
      yield* db.insert(threadEvent()).values({
        threadId: 't-racing',
        position: 1,
        id: 'g-e1',
        kind: 'message',
        payload: message({ id: 'g-1', text: 'Kolasin first', at: '2026-09-30T12:00:00.000Z' }).payload,
      });
      yield* db.run(sql`insert into thread_conversation (thread_id, through, seen) values (${'t-racing'}, 0, 2)`);
      yield* backfilled();
      expect((yield* search({ query: 'Kolasin', scope: { kind: 'projects', ids: [own] } })).coverage).toEqual({
        complete: false,
        unindexed: 1,
      });
      yield* db.insert(threadEvent()).values({
        threadId: 't-racing',
        position: 2,
        id: 'g-e2',
        kind: 'message',
        payload: message({ id: 'g-2', text: 'Kolasin landed late', at: '2026-09-30T12:01:00.000Z' }).payload,
      });
      yield* backfilled();
      expect([
        yield* matchesOf('t-racing', 'Kolasin'),
        (yield* search({ query: 'Kolasin', scope: { kind: 'projects', ids: [own] } })).coverage,
      ]).toEqual([['g-2', 'g-1'], { complete: true, unindexed: 0 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('a missing rested file is not replaced by its database suffix during backfill', () =>
    Effect.gen(function* () {
      const { files, db } = yield* World;
      const own = yield* registered('suffix');
      const path = yield* rested('t-suffix', own, message({ id: 'u-1', text: 'Perast first', at: '2026-09-30T10:00:00.000Z' }));
      yield* db.insert(threadEvent()).values({
        threadId: 't-suffix',
        position: 2,
        id: 'u-e2',
        kind: 'message',
        payload: message({ id: 'u-2', text: 'Perast later', at: '2026-09-30T10:05:00.000Z' }).payload,
      });
      const kept = yield* files.readFile(path);
      yield* files.remove(path);
      yield* forget('t-suffix');
      yield* backfilled();
      const partial = yield* search({ query: 'Perast', scope: { kind: 'projects', ids: [own] } });
      expect([yield* matchesOf('t-suffix', 'Perast'), partial.coverage]).toEqual([[], { complete: false, unindexed: 1 }]);
      yield* files.writeFile(path, kept);
      yield* backfilled();
      const whole = yield* search({ query: 'Perast', scope: { kind: 'projects', ids: [own] } });
      expect([yield* matchesOf('t-suffix', 'Perast'), whole.coverage]).toEqual([['u-1'], { complete: true, unindexed: 0 }]);
    }).pipe(Effect.provide(fixture)),
  );
  it.live('an unkeyable message leaves coverage open until a keep-warm marker excludes its run', () =>
    Effect.gen(function* () {
      const own = yield* registered('quiet');
      yield* thread('t-quiet', own);
      yield* append('t-quiet', message({ id: 'q-1', role: 'assistant', text: 'Zabljak', at: 'not a time', runId: 'run-q' }));
      expect((yield* search({ query: 'Zabljak', scope: { kind: 'projects', ids: [own] } })).coverage).toEqual({
        complete: false,
        unindexed: 1,
      });
      yield* append('t-quiet', {
        kind: 'signal',
        payload: {
          entry: {
            type: 'signal',
            id: 'warm-q',
            runId: 'run-q',
            signalType: 'keep-warm',
            addressee: 'transport',
            text: 'answer ok',
            occurredAt: '2026-09-30T11:00:00.000Z',
          },
        },
      });
      expect((yield* search({ query: 'Zabljak', scope: { kind: 'projects', ids: [own] } })).coverage).toEqual({
        complete: true,
        unindexed: 0,
      });
    }).pipe(Effect.provide(fixture)),
  );
});

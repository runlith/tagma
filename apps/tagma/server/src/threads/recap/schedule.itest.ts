import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { ActivityLog } from '@runlith/activity/log';
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { uuidv7 } from 'uuidv7';
import { agentAside } from '@runlith/agent/AgentAside';
import { withAgentReaderInput } from '@runlith/agent/AgentSignal';
import type { ModelRequest, ModelStreamInput } from '@runlith/agent/modelPort';
import { makeThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { subscriptionDescription } from '@runlith/builtin-catalog/subscription/description';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { project } from '../../projects/store/table.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadRecap } from '../../thread-record/contract/wire/recap.js';
import { eq } from 'drizzle-orm';
import { threadConversation, threadMessage } from '../store/conversation.js';
import { inboxSignalValues } from '@runlith/agent/thread/inboxItems';
import { USER_MESSAGE_SIGNAL_TYPE } from '@runlith/agent/contracts';
import { threadInbox } from '../store/tables.js';
import { thread, threadRun } from '../store/kernel.js';
import { conversationWrites } from '../store/journal.js';
import { conversationAppended } from '../journal/conversationIndex.js';
import { ThreadRecaps } from '../contract/service/recaps.js';
import { makeThreadRecaps } from './readings.js';
import { makeRecapSchedule } from './schedule.js';
import { AccountCredentials, ModelAccess } from '../../providers/contract/service/access.js';
import { Settings } from '../../settings/contract/service/values.js';
import { HarnessAsides, ThreadJournal } from '../contract/service/engine.js';
import { ThreadHistoryReads } from '../contract/service/birth.js';
import type { ExcerptAsks } from '../naming/excerpt.js';
import type { Roads } from '../roads.js';
import { CacheWarmth } from '../contract/service/evidence.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { RECAP_PAIRS } from '../operations/recap.js';
import { ThreadRecapWriting } from '../contract/service/recapWriting.js';
import { forProject } from '../../invocation/testing/call.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';

const ORIGIN = new ModelIdentity({ provider: ProviderID.make('subscription'), model: ModelID.make('claude-sonnet-5-5') });
const ACCOUNT = 'work';
const HEAD = 10;
const WAIT = 5 * 60_000;

class RecapProject extends Context.Service<RecapProject, number>()('test/RecapProject') {}

const store = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.orDie(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
  ),
);
const fixture = Layer.effectContext(
  Effect.gen(function* () {
    const { db } = yield* MachineStore;
    const units = yield* MachineUnits;
    const records = yield* makeThreadRecords;
    const createdAt = new Date(yield* Clock.currentTimeMillis);
    const row = yield* units.write('recap.project', (unit) =>
      unit.run(
        db
          .insert(project)
          .values({ name: 'recaps', repoKey: 'recaps', rootPath: '/tmp/recaps', createdAt })
          .returning({ id: project.id })
          .get(),
      ),
    );
    return Context.make(ThreadRecords, records).pipe(Context.add(RecapProject, row!.id));
  }),
).pipe(Layer.provideMerge(store));

type Said = { readonly role: 'operator' | 'agent'; readonly appeared: number; readonly runId: string };

const conversation = (runId: string): readonly Said[] => [
  { role: 'operator', appeared: 1, runId: 'run-0' },
  { role: 'agent', appeared: 2, runId: 'run-0' },
  { role: 'operator', appeared: 3, runId },
  { role: 'agent', appeared: 4, runId },
];

const born = Effect.fnUntraced(function* (runs: readonly string[], said: readonly Said[]) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const projectId = yield* RecapProject;
  const threadId = ThreadId.make(uuidv7());
  yield* units.write('recap.thread', (unit) =>
    Effect.gen(function* () {
      yield* records.insert(unit, { id: threadId, projectId, spawnRootId: threadId, principalId: 'operator', agentId: 'tagma' });
      yield* unit.run(
        db
          .insert(thread)
          .values({ id: threadId, cacheGroup: threadId, provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'high' }),
      );
      for (const id of runs)
        yield* unit.run(db.insert(threadRun).values({ id: `${threadId}:${id}`, threadId, ownerId: 'operator', status: 'completed' }));
      yield* unit.run(db.insert(threadConversation).values({ threadId, through: HEAD, seen: HEAD }));
    }),
  );
  for (const message of said) yield* say(threadId, message);
  return threadId;
});

const say = Effect.fnUntraced(function* (threadId: string, message: Said) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* units.write('recap.say', (unit) =>
    unit.run(
      db.insert(threadMessage).values({
        threadId,
        entryId: `${threadId}:entry-${message.appeared}`,
        position: message.appeared,
        appeared: message.appeared,
        runId: `${threadId}:${message.runId}`,
        role: message.role,
        occurredAt: message.appeared,
        text: `said ${message.appeared}`,
      }),
    ),
  );
});

const answering = (text: string): readonly LLMEvent[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text },
  { type: 'text-end', id: 't' },
  { type: 'finish', reason: 'stop' },
];

const JOURNAL: readonly Message[] = [Message.user('Publish the quarterly report.'), Message.assistant('Published it.')];

const journalRoad: Roads = {
  choose: () => Effect.succeed({ name: 'title-model', road: { _tag: 'Cli', cli: {} as never }, rejected: [] }),
};

const retold = (transcripts: string[], asked: Effect.Effect<void>): ExcerptAsks => ({
  asking: (_threadId, _road, question) =>
    Effect.sync(() => {
      const text = question.excerpt(10_000);
      transcripts.push(text);
      return {
        _tag: 'Asking' as const,
        text,
        ask: Effect.as(asked, {
          text: 'SUMMARY: The quarterly report was published.\nNEXT: none',
          finishReason: 'stop' as const,
          usage: undefined,
        }),
        usage: () => undefined,
      };
    }),
});

const world = Effect.fnUntraced(function* (
  answer: (input: ModelStreamInput) => Stream.Stream<LLMEvent>,
  cacheTtl: number | null = 3600,
  transcripts: string[] = [],
  retelling: Effect.Effect<void> = Effect.void,
) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const settings = { enabled: true, beforeRead: Effect.void as Effect.Effect<void> };
  const account = { value: ACCOUNT, beforeRead: Effect.void as Effect.Effect<void> };
  const running = { value: false };
  const asked: ModelStreamInput[] = [];
  const stopped: boolean[] = [];
  const answered = yield* Deferred.make<string>();
  const recapped = new Map<string, string | null>();
  const completed = new Map<string, Deferred.Deferred<string>>();
  const log: ActivityLog = {
    settled: Effect.void,
    record: (fact) => {
      if (fact._tag === 'Opened' && fact.kind === 'recap') recapped.set(fact.id, fact.thread);
      if (fact._tag !== 'Ended' || !recapped.has(fact.activity)) return;
      const effect = (fact.result as { readonly effect?: string }).effect;
      const outcome = effect === 'superseded' ? 'superseded' : fact.outcome;
      Deferred.doneUnsafe(answered, Exit.succeed(outcome));
      const threadId = recapped.get(fact.activity);
      const ready = threadId == null ? undefined : completed.get(threadId);
      if (ready !== undefined) Deferred.doneUnsafe(ready, Exit.succeed(outcome));
    },
  };
  const asides = yield* makeThreadAsides;
  const settingsDouble = { held: () => Effect.as(settings.beforeRead, () => settings.enabled) } as never;
  const recaps = yield* makeThreadRecaps;
  const journal = { head: HEAD, rows: [] as readonly { readonly position: number; readonly kind: string; readonly payload: unknown }[] };
  const models = modelCatalog([subscriptionDescription]);
  const select = (id: string) =>
    units.read((unit) =>
      unit.run(
        db
          .select({ provider: thread.provider, model: thread.model, reasoning: thread.reasoning, account: thread.account })
          .from(thread)
          .where(eq(thread.id, id))
          .get(),
      ),
    );
  const schedule = yield* makeRecapSchedule({
    roads: journalRoad,
    excerpts: retold(transcripts, retelling),
    published: () => Effect.void,
    progressed: () => Effect.void,
    timing: { waitMs: WAIT, marginMs: 60_000, idleMs: 60_000 },
  }).pipe(
    Effect.provideContext(
      Context.make(HarnessAsides, asides).pipe(
        Context.add(ThreadRecords, records),
        Context.add(Settings, settingsDouble),
        Context.add(ThreadJournal, {
          headPosition: () => Effect.sync(() => journal.head),
          recordsAsOf: () => Effect.sync(() => journal.rows),
        } as never),
        Context.add(ThreadRecaps, recaps),
        Context.add(ThreadLookup, {
          find: (id: string) =>
            Effect.map(select(id), (row) => (row === undefined ? undefined : { ...row, status: running.value ? 'running' : 'idle' })),
          summary: (id: string) =>
            Effect.map(select(id), (row) => {
              if (row === undefined) return undefined;
              const at = new Date().toISOString();
              const reading = {
                usage: new Usage({ inputTokens: 1_000 }),
                contextWindow: null,
                runId: 'run',
                stepNumber: 0,
                provider: row.provider,
                model: row.model,
                measuredAt: at,
                sentAt: at,
                cache: { ttlSeconds: cacheTtl },
                stale: false,
              };
              return { ...row, contextReading: reading };
            }),
        } as never),
        Context.add(ThreadHistoryReads, { of: () => Effect.succeed(JOURNAL) } as never),
        Context.add(ModelAccess, { request: () => ({ origin: ORIGIN, rung: 'high' }) } as never),
        Context.add(AccountCredentials, {
          account: () =>
            Effect.andThen(
              account.beforeRead,
              Effect.sync(() => account.value),
            ),
        } as never),
        Context.add(CacheWarmth, { warmthBasis: () => Effect.succeed({ curves: new Map(), accounts: new Map(), models }) } as never),
        Context.add(ActivityLog, log),
      ),
    ),
  );
  asides.watch(schedule);
  const request = (runAnswer: (input: ModelStreamInput) => Stream.Stream<LLMEvent>): ModelRequest => ({
    plannedOutputTokens: 0,
    origin: ORIGIN,
    rung: 'high',
    cache: cacheTtl === null ? undefined : { ttlSeconds: cacheTtl },
    signedAccount: () => ACCOUNT,
    stream: (input) => {
      const index = asked.push(input) - 1;
      stopped[index] = false;
      let ended = false;
      return runAnswer(input).pipe(
        Stream.onEnd(
          Effect.sync(() => {
            ended = true;
          }),
        ),
        Stream.onExit(() =>
          Effect.sync(() => {
            stopped[index] = !ended;
          }),
        ),
      );
    },
    text: () => Effect.die(new Error('not used')),
    object: () => Effect.die(new Error('not used')),
  });
  const settle = Effect.fnUntraced(function* (threadId: string, runId: string, readerInput = `message:user:${threadId}:${runId}`) {
    completed.set(threadId, yield* Deferred.make<string>());
    const now = yield* Clock.currentTimeMillis;
    const aside = agentAside({
      runId: `${threadId}:${runId}`,
      stepNumber: 0,
      request: request(answer),
      messages: [withAgentReaderInput(Message.user('publish the report'), readerInput)],
      tools: {},
      stallMs: 60_000,
      sentAt: now,
      answer: { messages: [Message.assistant('Published.')], measuredAt: now },
    });
    yield* asides.hold(threadId, aside);
    yield* asides.settled(threadId, `${threadId}:${runId}`);
  });
  const whenCompleted = (threadId: string) =>
    Effect.suspend(() => {
      const ready = completed.get(threadId);
      return ready === undefined ? Effect.die('The recap test has not settled this thread') : Deferred.await(ready);
    });
  return { asked, stopped, answered, settings, account, running, recaps, journal, asides, settle, schedule, whenCompleted };
});

const readingOf = Effect.fnUntraced(function* (recaps: ThreadRecaps['Service'], threadId: string) {
  return (yield* recaps.readings([{ id: threadId, projectId: yield* RecapProject }])).get(threadId);
});

const RECAPPED = answering('SUMMARY: The report was drafted, reviewed and published.\nNEXT: none');

const steer = Effect.fnUntraced(function* (threadId: string, id: string, state: 'queued' | 'acknowledged') {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* units.write('recap.steer', (unit) => {
    const values = inboxSignalValues(threadId, {
      id,
      type: USER_MESSAGE_SIGNAL_TYPE,
      addressee: 'reader',
      text: 'and the chart too',
      occurredAt: new Date(1_000).toISOString(),
    });
    return unit.run(db.insert(threadInbox).values({ ...values, state, occurredAt: new Date(values.occurredAt) } as never));
  });
});

const recapAt = (position: number): ThreadRecap => ({
  summary: 'Earlier.',
  next: null,
  voided: false,
  basis: {
    position,
    entryId: `entry-${position}`,
    runId: 'run-0',
    journalHead: position,
    generatedAt: '2026-10-01T00:00:00.000Z',
    provider: 'subscription',
    model: 'claude-sonnet-5-5',
  },
});

const writeRecap = Effect.fnUntraced(function* (threadId: string, recap: ThreadRecap) {
  const records = yield* ThreadRecords;
  const units = yield* MachineUnits;
  return yield* units.write('recap.write', (unit) => records.writeRecap(unit, threadId, recap));
});

layer(fixture)('recap schedule', (it) => {
  it.effect('a manual recap writes and reaches the normal reading immediately after one exchange with automatic recording off', () =>
    Effect.gen(function* () {
      const projectId = yield* RecapProject;
      const threadId = yield* born(['run-1'], conversation('run-1').slice(2));
      const w = yield* world(() => Stream.fromIterable(RECAPPED));
      w.settings.enabled = false;
      yield* w.settle(threadId, 'run-1');
      const written = yield* RECAP_PAIRS.generate_thread_recap.body
        .execute({ threadId }, undefined, { actor: { kind: 'operator' }, files: null })
        .pipe(
          forProject(Effect.succeed({ project: { id: projectId, name: 'recaps' } })),
          Effect.provideService(ThreadRecapWriting, { generate: (id, project) => w.schedule.generateNow(id, project) }),
        );
      const reading = yield* readingOf(w.recaps, threadId);
      expect(written).toEqual({ status: 'written', threadId, recap: reading! });
      expect(w.recaps.attempt(threadId)).toBeNull();
      expect(reading).toMatchObject({
        summary: 'The report was drafted, reviewed and published.',
        status: 'current',
        basis: { position: 4, entryId: `${threadId}:entry-4`, runId: `${threadId}:run-1` },
      });
    }),
  );

  it.effect('settlement cannot replace a manual writer admitted while automatic policy is being read', () =>
    Effect.gen(function* () {
      const projectId = yield* RecapProject;
      const threadId = yield* born(['run-0', 'run-1', 'run-2'], conversation('run-1'));
      const policyRead = yield* Deferred.make<void>();
      const policyReady = yield* Deferred.make<void>();
      const modelOpened = yield* Deferred.make<void>();
      const modelReady = yield* Deferred.make<void>();
      const w = yield* world(() =>
        Stream.fromEffect(Effect.andThen(Deferred.succeed(modelOpened, undefined), Deferred.await(modelReady))).pipe(
          Stream.flatMap(() => Stream.fromIterable(RECAPPED)),
        ),
      );
      w.settings.beforeRead = Effect.andThen(Deferred.succeed(policyRead, undefined), Deferred.await(policyReady));
      const settlement = yield* Effect.forkScoped(w.settle(threadId, 'run-1'));
      yield* Deferred.await(policyRead);
      const writing = yield* Effect.forkScoped(Effect.result(w.schedule.generateNow(threadId, projectId)));
      yield* Deferred.await(modelOpened);
      yield* Deferred.succeed(policyReady, undefined);
      yield* Fiber.join(settlement);
      yield* w.asides.opened(threadId, `${threadId}:run-2`, false);
      expect(w.stopped[0]).toBe(true);
      yield* Deferred.succeed(modelReady, undefined);
      expect(yield* Fiber.join(writing)).toMatchObject({ _tag: 'Failure', failure: { code: 'recap-moved' } });
      expect(yield* readingOf(w.recaps, threadId)).toBeUndefined();
    }),
  );

  it.effect('interrupting a manual caller aborts its model request and preserves the previous recap', () =>
    Effect.gen(function* () {
      const projectId = yield* RecapProject;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      yield* writeRecap(threadId, recapAt(2));
      const opened = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const w = yield* world(() =>
        Stream.fromEffect(Effect.andThen(Deferred.succeed(opened, undefined), Deferred.await(ready))).pipe(
          Stream.flatMap(() => Stream.fromIterable(RECAPPED)),
        ),
      );
      w.settings.enabled = false;
      yield* w.settle(threadId, 'run-1');
      const writing = yield* Effect.forkScoped(w.schedule.generateNow(threadId, projectId));
      yield* Deferred.await(opened);
      yield* Fiber.interrupt(writing);
      expect(w.stopped[0]).toBe(true);
      yield* Deferred.succeed(ready, undefined);
      yield* Deferred.await(w.answered);
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({ summary: 'Earlier.', basis: { position: 2 } });
      expect(yield* w.schedule.generateNow(threadId, projectId)).toMatchObject({
        summary: 'The report was drafted, reviewed and published.',
        status: 'current',
      });
    }),
  );

  it.effect('publication refuses persisted model, reasoning or account changes made during credential resolution', () =>
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const projectId = yield* RecapProject;
      for (const change of [{ model: 'claude-opus-5-5' }, { reasoning: 'low' }, { account: 'personal' }]) {
        const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
        yield* writeRecap(threadId, recapAt(2));
        const modelOpened = yield* Deferred.make<void>();
        const modelReady = yield* Deferred.make<void>();
        const credentialsRead = yield* Deferred.make<void>();
        const credentialsReady = yield* Deferred.make<void>();
        const w = yield* world(() =>
          Stream.fromEffect(Effect.andThen(Deferred.succeed(modelOpened, undefined), Deferred.await(modelReady))).pipe(
            Stream.flatMap(() => Stream.fromIterable(RECAPPED)),
          ),
        );
        w.settings.enabled = false;
        yield* w.settle(threadId, 'run-1');
        const writing = yield* Effect.forkScoped(Effect.result(w.schedule.generateNow(threadId, projectId)));
        yield* Deferred.await(modelOpened);
        w.account.beforeRead = Effect.andThen(Deferred.succeed(credentialsRead, undefined), Deferred.await(credentialsReady));
        yield* Deferred.succeed(modelReady, undefined);
        yield* Deferred.await(credentialsRead);
        yield* units.write('recap.selection', (unit) => unit.run(db.update(thread).set(change).where(eq(thread.id, threadId))));
        yield* Deferred.succeed(credentialsReady, undefined);
        expect(yield* Fiber.join(writing)).toMatchObject({ _tag: 'Failure', failure: { code: 'recap-selection' } });
        expect(yield* readingOf(w.recaps, threadId)).toMatchObject({ summary: 'Earlier.', basis: { position: 2 } });
      }
    }),
  );

  it.effect('automatic publication observes a setting switched off while its write unit is pending', () =>
    Effect.gen(function* () {
      const units = yield* MachineUnits;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      yield* writeRecap(threadId, recapAt(2));
      const pendingWrite = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const publicationUnits = MachineUnits.of({
        read: (work, options) => units.read(work, options),
        markReadOnly: (work) => units.markReadOnly(work),
        markWrite: (work) => units.markWrite(work),
        write: (writes, work) =>
          Effect.andThen(Deferred.succeed(pendingWrite, undefined), Deferred.await(ready)).pipe(Effect.andThen(units.write(writes, work))),
      });
      const w = yield* world(() => Stream.fromIterable(RECAPPED)).pipe(Effect.provideService(MachineUnits, publicationUnits));
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      yield* Deferred.await(pendingWrite);
      w.settings.enabled = false;
      yield* Deferred.succeed(ready, undefined);
      yield* Deferred.await(w.answered);
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({ summary: 'Earlier.', status: 'stale', basis: { position: 2 } });
    }),
  );

  it.effect('a capture without a cache promise gets no automatic recap, and the manual one retells the journal', () =>
    Effect.gen(function* () {
      const projectId = yield* RecapProject;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      const transcripts: string[] = [];
      const w = yield* world(() => Stream.fromIterable(RECAPPED), null, transcripts);
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      expect(yield* readingOf(w.recaps, threadId)).toBeUndefined();
      expect(yield* w.schedule.generateNow(threadId, projectId)).toMatchObject({
        summary: 'The quarterly report was published.',
        status: 'current',
        basis: { position: 4, entryId: `${threadId}:entry-4` },
      });
      expect(w.asked).toHaveLength(0);
      expect(transcripts).toEqual(['User: Publish the quarterly report.\n\nAssistant: Published it.']);
    }),
  );

  it.effect('a second manual recap while the journal is retold is refused and leaves the first one to publish', () =>
    Effect.gen(function* () {
      const projectId = yield* RecapProject;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      const opened = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const w = yield* world(
        () => Stream.fromIterable(RECAPPED),
        null,
        [],
        Effect.andThen(Deferred.succeed(opened, undefined), Deferred.await(ready)),
      );
      const first = yield* Effect.forkScoped(w.schedule.generateNow(threadId, projectId));
      yield* Deferred.await(opened);
      expect(yield* Effect.result(w.schedule.generateNow(threadId, projectId))).toMatchObject({
        _tag: 'Failure',
        failure: { code: 'recap-running' },
      });
      yield* Deferred.succeed(ready, undefined);
      expect(yield* Fiber.join(first)).toMatchObject({ summary: 'The quarterly report was published.', status: 'current' });
    }),
  );

  it.effect('a new turn interrupts a manual recap with a visible refusal and keeps the old recap', () =>
    Effect.gen(function* () {
      const projectId = yield* RecapProject;
      const threadId = yield* born(['run-0', 'run-1', 'run-2'], conversation('run-1'));
      yield* writeRecap(threadId, recapAt(2));
      const opened = yield* Deferred.make<void>();
      const w = yield* world(() => Stream.fromEffect(Deferred.succeed(opened, undefined)).pipe(Stream.flatMap(() => Stream.never)));
      w.settings.enabled = false;
      yield* w.settle(threadId, 'run-1');
      const writing = yield* Effect.forkScoped(Effect.result(w.schedule.generateNow(threadId, projectId)));
      yield* Deferred.await(opened);
      yield* w.asides.opened(threadId, `${threadId}:run-2`, false);
      expect(yield* Fiber.join(writing)).toMatchObject({ _tag: 'Failure', failure: { code: 'recap-moved' } });
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({ summary: 'Earlier.', status: 'stale', basis: { position: 2 } });
    }),
  );

  it.effect('a settled run the reader spoke in is recapped on its warm capture once the wait passes', () =>
    Effect.gen(function* () {
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      const w = yield* world(() => Stream.fromIterable(RECAPPED));
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('4 minutes');
      expect(w.asked).toHaveLength(0);
      yield* TestClock.adjust('1 minute');
      yield* Deferred.await(w.answered);
      expect(w.asked).toHaveLength(1);
      expect(w.asked[0]!.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({
        summary: 'The report was drafted, reviewed and published.',
        next: null,
        status: 'current',
        basis: { position: 4, entryId: `${threadId}:entry-4`, runId: `${threadId}:run-1`, journalHead: HEAD },
      });
    }),
  );

  it.effect('an automatic recap is the thread attempt at its anchor while the model writes, and its refusal once the model fails', () =>
    Effect.gen(function* () {
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      const opened = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const w = yield* world(() =>
        Stream.fromEffect(Effect.andThen(Deferred.succeed(opened, undefined), Deferred.await(ready))).pipe(
          Stream.flatMap(() => Stream.fromIterable(answering('no frame'))),
        ),
      );
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      yield* Deferred.await(opened);
      expect(w.recaps.attempt(threadId)).toEqual({ state: 'writing', entryId: `${threadId}:entry-4` });
      yield* Deferred.succeed(ready, undefined);
      yield* Deferred.await(w.answered);
      expect(w.recaps.attempt(threadId)).toMatchObject({ state: 'refused', entryId: `${threadId}:entry-4`, code: 'recap-malformed' });
    }),
  );

  it.effect('a new turn opened before the deadline cancels the wait, and a keep-warm run does not', () =>
    Effect.gen(function* () {
      const warmed = yield* born(['run-0', 'run-1', 'warm'], conversation('run-1'));
      const turned = yield* born(['run-0', 'run-1', 'run-2'], conversation('run-1'));
      const w = yield* world(() => Stream.fromIterable(RECAPPED));
      yield* w.settle(warmed, 'run-1');
      yield* w.settle(turned, 'run-1');
      yield* w.asides.opened(warmed, `${warmed}:warm`, true);
      yield* w.asides.opened(turned, `${turned}:run-2`, false);
      yield* TestClock.adjust('5 minutes');
      yield* w.whenCompleted(warmed);
      expect((yield* readingOf(w.recaps, warmed))?.status).toBe('current');
      expect(yield* readingOf(w.recaps, turned)).toBeUndefined();
      expect(w.asked).toHaveLength(1);
    }),
  );

  it.effect('a turn opened while the recap is generated stops the question and publishes nothing', () =>
    Effect.gen(function* () {
      const threadId = yield* born(['run-0', 'run-1', 'run-2'], conversation('run-1'));
      const opened = yield* Deferred.make<void>();
      const w = yield* world(() => Stream.fromEffect(Deferred.succeed(opened, undefined)).pipe(Stream.flatMap(() => Stream.never)));
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      yield* Deferred.await(opened);
      yield* w.asides.opened(threadId, `${threadId}:run-2`, false);
      expect(w.stopped[0]).toBe(true);
      expect(yield* readingOf(w.recaps, threadId)).toBeUndefined();
    }),
  );

  it.effect('a covered message rewritten while the recap is generated keeps the result unpublished', () =>
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      const opened = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const w = yield* world(() =>
        Stream.fromEffect(Effect.andThen(Deferred.succeed(opened, undefined), Deferred.await(release))).pipe(
          Stream.flatMap(() => Stream.fromIterable(RECAPPED)),
        ),
      );
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      yield* Deferred.await(opened);
      yield* units.write('recap.rewrite', (unit) =>
        unit.run(
          db
            .update(threadConversation)
            .set({ through: HEAD + 1 })
            .where(eq(threadConversation.threadId, threadId)),
        ),
      );
      w.journal.head = HEAD + 1;
      w.journal.rows = [{ position: HEAD + 1, kind: 'message', payload: { entry: { id: `${threadId}:entry-3` } } }];
      yield* Deferred.succeed(release, undefined);
      expect(yield* Deferred.await(w.answered)).toBe('superseded');
      expect(yield* readingOf(w.recaps, threadId)).toBeUndefined();
    }),
  );

  it.effect(
    "a steer of the reader's own counts as speaking in the thread; an agent's envelope and words inherited from another thread's run do not",
    () =>
      Effect.gen(function* () {
        const { db } = yield* MachineStore;
        const units = yield* MachineUnits;
        const steered = yield* born(['run-0', 'run-1'], conversation('run-1'));
        yield* steer(steered, `${steered}:steer`, 'acknowledged');
        const enveloped = yield* born(['run-0', 'run-1'], conversation('run-1'));
        yield* units.write('recap.envelope', (unit) =>
          unit.run(
            db.insert(threadInbox).values({
              id: `${enveloped}:envelope`,
              threadId: enveloped,
              sender: { kind: 'thread', threadId: steered, name: 'orchestrator' },
              kind: 'envelope',
              body: { intent: 'message', text: 'and the chart too', inReplyTo: null },
              state: 'acknowledged',
              occurredAt: new Date(1_000),
            } as never),
          ),
        );
        const inherited = yield* born(['run-0', 'run-1'], conversation('run-1'));
        const w = yield* world(() => Stream.fromIterable(RECAPPED));
        yield* w.settle(steered, 'run-1', `${steered}:steer`);
        yield* w.settle(enveloped, 'run-1', `${enveloped}:envelope`);
        yield* w.settle(inherited, 'run-1', `message:user:${inherited}:run-of-the-source`);
        yield* TestClock.adjust('5 minutes');
        yield* w.whenCompleted(steered);
        expect(w.asked).toHaveLength(1);
      }),
  );

  it.effect("the reader's words queued while the recap is generated keep the result unpublished", () =>
    Effect.gen(function* () {
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      const opened = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const w = yield* world(() =>
        Stream.fromEffect(Effect.andThen(Deferred.succeed(opened, undefined), Deferred.await(release))).pipe(
          Stream.flatMap(() => Stream.fromIterable(RECAPPED)),
        ),
      );
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      yield* Deferred.await(opened);
      yield* steer(threadId, `${threadId}:waiting`, 'queued');
      yield* Deferred.succeed(release, undefined);
      expect(yield* Deferred.await(w.answered)).toBe('superseded');
      expect(yield* readingOf(w.recaps, threadId)).toBeUndefined();
    }),
  );

  it.effect('a changed account leaves the earlier recap standing with its status', () =>
    Effect.gen(function* () {
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      yield* writeRecap(threadId, recapAt(2));
      const w = yield* world(() => Stream.fromIterable(RECAPPED));
      yield* w.settle(threadId, 'run-1');
      w.account.value = 'personal';
      yield* TestClock.adjust('5 minutes');
      yield* Deferred.await(w.answered);
      expect(w.asked).toHaveLength(0);
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({ summary: 'Earlier.', status: 'stale', basis: { position: 2 } });
    }),
  );

  it.effect('a recap reads stale after a later message and void once the index rewinds a turn it covered', () =>
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      yield* writeRecap(threadId, recapAt(4));
      const w = yield* world(() => Stream.fromIterable(RECAPPED));
      expect((yield* readingOf(w.recaps, threadId))?.status).toBe('current');
      yield* say(threadId, { role: 'operator', appeared: 5, runId: 'run-2' });
      expect((yield* readingOf(w.recaps, threadId))?.status).toBe('stale');
      yield* units.write(conversationWrites, (unit) =>
        conversationAppended(db, unit, threadId, {
          position: HEAD + 1,
          payload: { rewound: { id: 'rewind-1', scope: 'turn', runIds: [`${threadId}:run-0`] } } as never,
        }),
      );
      expect((yield* readingOf(w.recaps, threadId))?.status).toBe('void');
    }),
  );

  it.effect('turning automatic recaps off prevents generation and keeps the saved recap readable', () =>
    Effect.gen(function* () {
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      yield* writeRecap(threadId, recapAt(2));
      const w = yield* world(() => Stream.fromIterable(RECAPPED));
      w.settings.enabled = false;
      yield* w.settle(threadId, 'run-1');
      yield* TestClock.adjust('5 minutes');
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({ summary: 'Earlier.', status: 'stale', basis: { position: 2 } });
      w.settings.enabled = true;
      expect(w.asked).toHaveLength(0);
      expect((yield* readingOf(w.recaps, threadId))?.summary).toBe('Earlier.');
    }),
  );

  it.effect('a capture answered by the agent session writes the recap of a thread whose model Tagma does not hold', () =>
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const threadId = yield* born(['run-0', 'run-1'], conversation('run-1'));
      yield* units.write('recap.external', (unit) =>
        unit.run(db.update(thread).set({ provider: 'external', model: null, reasoning: null }).where(eq(thread.id, threadId))),
      );
      const w = yield* world(() => Stream.die(new Error('the session answers this capture')));
      const questions: string[] = [];
      const now = yield* Clock.currentTimeMillis;
      yield* w.asides.hold(threadId, {
        source: 'session',
        runId: `${threadId}:run-1`,
        stepNumber: 0,
        readerInput: `message:user:${threadId}:run-1`,
        readerPosition: null,
        binding: {
          origin: new ModelIdentity({ provider: ProviderID.make('claude-code'), model: ModelID.make('claude-opus-5-5') }),
          account: undefined,
          cache: undefined,
        },
        reasoning: 'xhigh',
        sentAt: now,
        measuredAt: now,
        expiresAt: now + 300_000,
        ask: (question) =>
          Effect.sync(() => {
            questions.push(question.instruction);
            return {
              text: 'SUMMARY: The report was drafted, reviewed and published.\nNEXT: none',
              finishReason: 'stop' as const,
              usage: undefined,
            };
          }),
      });
      yield* w.asides.settled(threadId, `${threadId}:run-1`);
      yield* TestClock.adjust('4 minutes');
      expect(yield* Deferred.await(w.answered)).toBe('ok');
      expect(questions).toHaveLength(1);
      expect(yield* readingOf(w.recaps, threadId)).toMatchObject({
        summary: 'The report was drafted, reviewed and published.',
        status: 'current',
        basis: { provider: 'claude-code', model: 'claude-opus-5-5' },
      });
    }),
  );
});

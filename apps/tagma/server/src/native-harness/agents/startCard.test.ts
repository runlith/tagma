import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Brand, Effect, Schema } from 'effect';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { scriptedWorld, COMPACTION_POLICY, COMPACTION_PROMPT, COMPACTION_TEXT } from '@runlith/agent/thread/conformance/runLog/world';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { compositionEntryId } from '@runlith/agent/transcript/entryNames';
import type { ThreadCompositionEntry } from '@runlith/agent/transcript/entries';
import type { RequestLanded } from '@runlith/agent/thread/run/requests';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadRecordFacts } from '../../thread-record/contract/wire/record.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { writes } from '../../platform/contract/service/writes.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ModelAccess } from '../../providers/contract/service/access.js';
import { START_ENTRY, StartEntry, isStartEntry, startEntryId } from '../contract/wire/start.js';
import { startCards } from './startCard.js';

const unread = () => Effect.die('the start-card contract does not reach this operation');
const unobserved = () => {
  throw new Error('the start-card contract subscribes through the kernel request port');
};
const kinds = makeThreadEntryReader({ products: [{ type: START_ENTRY, schema: StartEntry }] });
const models = ModelAccess.of({
  request: unobserved,
  defaultModel: () => 'small',
  served: () =>
    Effect.succeed({
      id: 'small',
      capacity: { context: 1_000 },
      cacheLifetime: { promisedSeconds: null, prior: null },
      requestLimits: undefined,
      compactionTrigger: undefined,
    }),
});
type Given = {
  readonly facts?: Partial<ThreadRecordFacts>;
  readonly opening?: boolean;
  readonly usage?: boolean;
};

const fixture = Effect.gen(function* () {
  const storage = yield* openMemoryStorage(kinds);
  const world = yield* scriptedWorld(storage, 'tagma', { harness: { ownerId: OPERATOR_PRINCIPAL } });
  const facts = new Map<string, ThreadRecordFacts>();
  const records = ThreadRecords.of({
    writes: writes('testing/start-cards', []),
    facts: (id) => Effect.succeed(facts.get(id)),
    projectOf: unread,
    address: unread,
    projectsOf: unread,
    countIn: unread,
    namesIn: unread,
    isDescendant: unread,
    relation: unread,
    subtree: unread,
    insert: unread,
    scope: unread,
    harnessed: unread,
    remove: unread,
    publishStatus: unread,
    setArchived: unread,
    setPinned: unread,
    detach: unread,
    reattach: unread,
    advanceReaderOrder: unread,
    rehome: unread,
    setTitle: unread,
    nameTitle: unread,
    adoptTitle: unread,
    claimTitleInput: unread,
    writeRecap: unread,
    voidRecap: unread,
    birthRecorded: unobserved,
    removalRecorded: unobserved,
    titleRecorded: unobserved,
    statusPublished: unobserved,
    shelfRecorded: unobserved,
  });
  let share = 0.4;
  const settings = Settings.of({
    read: unread,
    value: (key) => Schema.decodeUnknownEffect(key.schema)(share).pipe(Effect.orDie),
    chain: unread,
    live: unread,
    held: unread,
    changes: unread,
    write: unread,
    amend: unread,
  });
  const compaction = makeThreadCompaction({
    models,
    checkpoints: storage.compaction,
    policy: () => Effect.succeed(COMPACTION_POLICY),
    strategy: makeThreadSummaryStrategy({ models, prompt: COMPACTION_PROMPT }),
    recovery: makeThreadDigestStrategy(),
    text: COMPACTION_TEXT,
  });
  const land = startCards({
    records,
    store: storage.aggregate,
    settings,
    models,
    compaction: { ...compaction, charsPerToken: () => 2 },
    threads: world.harness.threads,
  });
  const create = Effect.fnUntraced(function* (given: Given = {}) {
    const row = yield* storage.aggregate.insert({ ownerId: OPERATOR_PRINCIPAL, agentId: 'tagma', provider: 'fixture', model: 'small' });
    const id = ThreadId.make(row.id);
    facts.set(id, {
      id,
      projectId: 7,
      origin: 'scoped',
      parentId: null,
      spawnRootId: id,
      detachedFrom: null,
      detachedAt: null,
      principalId: OPERATOR_PRINCIPAL,
      name: null,
      title: 'Start cost',
      titleProvenance: 'manual',
      titleRevision: 0,
      harness: Brand.nominal<HarnessId>()('tagma'),
      agentId: 'tagma',
      bornOf: null,
      spawnedByRunId: null,
      createdBy: OPERATOR_PRINCIPAL,
      scopeBlockUuid: null,
      createdBySessionId: null,
      readerOrderAt: new Date(0),
      pinnedAt: null,
      archivedAt: null,
      status: 'idle',
      runningRunId: null,
      recap: null,
      createdAt: new Date(0),
      ...given.facts,
    });
    const started = yield* storage.runs({ ownerId: 'request-owner', scope: 'scope-a' }).createRun({
      startFrom: row,
      kind: 'turn',
      approval: { mode: 'bypass', interactive: false },
      progress: { stage: 'running', message: '' },
    });
    const composition: ThreadCompositionEntry = {
      type: 'composition',
      id: compositionEntryId(started.run.id),
      runId: started.run.id,
      occurredAt: started.run.createdAt.toISOString(),
      opening: given.opening === false ? undefined : true,
      system: { chars: 800 },
      context: null,
      tools: {
        count: 2,
        chars: 700,
        each: [
          { name: 'read', chars: 200 },
          { name: 'deferred', chars: 500, hidden: true },
        ],
      },
      ...(given.usage === false
        ? {}
        : { tokens: { total: 1_111, system: 400, context: null, tools: 100, each: [{ name: 'read', tokens: 100 }] } }),
    };
    yield* storage.aggregate.appendEntries(id, { transcript: [composition] });
    return { run: started.run, stepNumber: 0, attempt: 0, usage: null } satisfies RequestLanded;
  });
  return {
    create,
    land,
    share: (value: number) => {
      share = value;
    },
    cards: (id: string) => Effect.map(storage.aggregate.transcriptOf(id), (entries) => (entries ?? []).filter(isStartEntry)),
  };
});

it.effect('only a scoped operator root at the first opening request receives a start card', () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    for (const given of [
      { facts: { parentId: ThreadId.make('parent') } },
      { facts: { createdBy: 'plugin:schedule' } },
      { facts: { createdBy: 'agent-root-creator' } },
      { facts: { createdBy: null } },
      { facts: { projectId: null } },
      { opening: false },
    ] satisfies Given[]) {
      const request = yield* test.create(given);
      yield* test.land(request);
      expect(yield* test.cards(request.run.threadId)).toEqual([]);
    }
    const later = yield* test.create();
    yield* test.land({ ...later, stepNumber: 1 });
    yield* test.land({ ...later, run: { ...later.run, provider: null } });
    expect(yield* test.cards(later.run.threadId)).toEqual([]);
    yield* test.land(later);
    expect(yield* test.cards(later.run.threadId)).toHaveLength(1);
  }),
);

it.effect('the calibrated threshold is strict, deferred tools do not count, and a repeated landing replaces one card', () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const request = yield* test.create();
    test.share(0.5);
    yield* test.land(request);
    expect(yield* test.cards(request.run.threadId)).toEqual([]);
    test.share(0.49);
    yield* test.land(request);
    yield* test.land(request);
    yield* test.land({ ...request, stepNumber: 1 });
    const cards = yield* test.cards(request.run.threadId);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: startEntryId(request.run.threadId),
      runId: request.run.id,
      chars: 1_000,
      tokens: 500,
      inputTokens: 1_111,
      window: 1_000,
      share: 0.49,
    });
    expect(cards[0]?.parts).toEqual([
      { id: 'system', chars: 800 },
      { id: 'tools', chars: 200 },
      { id: 'law', chars: null },
      { id: 'vocabulary', chars: null },
      { id: 'graph', chars: null },
      { id: 'workspace', chars: null },
      { id: 'deferred', chars: null },
    ]);
    const unbilled = yield* test.create({ usage: false });
    yield* test.land(unbilled);
    expect((yield* test.cards(unbilled.run.threadId))[0]?.inputTokens).toBeNull();
  }),
);

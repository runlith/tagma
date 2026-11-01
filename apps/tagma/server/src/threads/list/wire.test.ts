import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Schema } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { HARNESS_OFFER } from '../contract/wire/harness/seat.js';
import { threadListRowSchema, type ThreadListRow } from '../contract/wire/list.js';
import type { HarnessPresentation } from '../contract/wire/harness/externalSession.js';
import type { ThreadListProjection } from './summary.js';
import { LEASE_RHYTHM } from '../contract/wire/rhythm.js';
import { unmeasuredObservation } from '../contract/wire/harness/observation.js';
import { threadLine } from '../voice/threadText.js';
import { threadPageBefore, threadRecordAddress, threadSelectionOf, wireThread } from './wire.js';
import type { WarmthBasis } from '../contract/wire/warmth.js';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';

const PRESENTATION: HarnessPresentation = {
  label: 'Acme CLI',
  iconProvider: 'acme',
  mark: null,
  install: null,
  modelProvider: null,
  terminal: true,
  acp: false,
  hosted: false,
  sharedSessions: true,
};

it.effect('page cursors refuse invalid instants and preserve ordinary continuation positions', () =>
  Effect.gen(function* () {
    const raw = Buffer.from(JSON.stringify({ at: 1e20, id: 'thread-1' })).toString('base64url');
    const refused = yield* Effect.exit(threadSelectionOf({ before: raw }));
    if (Exit.isSuccess(refused)) return yield* Effect.die('an invalid cursor was accepted');
    expect(Cause.squash(refused.cause)).toMatchObject({ code: 'selection-shape' });
    const cursor = { orderAt: new Date('2026-08-28T00:00:00Z'), id: 'thread-1' };
    const before = threadPageBefore(cursor);
    if (before === null) return yield* Effect.die('the page cursor was lost');
    const selection = yield* threadSelectionOf({ before });
    expect(selection.before).toEqual(cursor);
  }),
);

const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

const NO_BASIS: WarmthBasis = { curves: new Map(), accounts: new Map(), models: MODELS };

const WINDOW: ThreadContextLimit = { window: 100_000, compaction: null };
const COMPACTING: ThreadContextLimit = {
  window: 100_000,
  compaction: { at: 80_000, strategy: 'percent', share: 0.8, source: 'override' },
};

const wire = (entry: ThreadListProjection, warmth: WarmthBasis = NO_BASIS, limit: ThreadContextLimit | null = WINDOW) =>
  wireThread(entry, { warmth, limits: new Map(limit === null ? [] : [[entry.id, limit]]) });

function row(over: Partial<ThreadListProjection> = {}): ThreadListProjection {
  const moment = new Date('2026-08-28T00:00:00.000Z');
  return {
    id: 'thread-1',
    ownerId: 'operator',
    agentId: 'tagma',
    parentThreadId: null,
    spawnedByRunId: null,
    bornOf: null,
    spawnRootId: 'thread-1',
    cacheGroup: 'thread-1',
    name: null,
    authority: { mode: 'trust', bypassFrom: null },
    plain: false,
    profile: null,
    budgetTokens: null,
    hostKind: null,
    hostId: null,
    bindings: {},
    pendingInteraction: null,
    account: null,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    reasoning: 'high',
    switches: {},
    transport: NATIVE_BINDING,
    capabilities: NATIVE_CAPABILITIES,
    status: 'idle',
    failureReason: null,
    contextReading: null,
    createdBy: null,
    createdAt: moment,
    updatedAt: moment,
    title: 'worker',
    titleOrigin: 'random',
    projectId: 1,
    scopeBlockUuid: null,
    createdBySessionId: null,
    readerOrderAt: moment,
    liveSpellStartedAt: null,
    pinnedAt: null,
    folderId: null,
    archivedAt: null,
    detachedFrom: null,
    activeRun: null,
    life: 'idle',
    owes: false,
    outcome: null,
    ask: null,
    saidLine: null,
    recap: null,
    phase: null,
    held: { paths: 0, unproven: 0 },
    harness: null,
    ...over,
  };
}

function beating(over: Partial<ThreadListProjection['activeRun'] & object> = {}): ThreadListProjection['activeRun'] {
  const now = new Date();
  return {
    id: 'run-1',
    heartbeatAt: now,
    startedAt: now,
    awaitingQuestion: false,
    phase: null,
    halt: null,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    reasoning: 'high',
    ...over,
  };
}

function reading(over: Partial<NonNullable<ThreadListProjection['contextReading']>> = {}): ThreadListProjection['contextReading'] {
  return {
    usage: new Usage({ inputTokens: 50_000, outputTokens: 10_000, totalTokens: 60_000 }),
    contextWindow: 100_000,
    runId: 'run-1',
    stepNumber: 3,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    measuredAt: '2026-08-28T09:00:00.000Z',
    stale: false,
    ...over,
  };
}

test('a standing run carries its own selection, and the thread names what it is set to', () => {
  const entry = wire(
    row({
      status: 'running',
      provider: 'subscription',
      model: 'claude-fable-5-1',
      reasoning: 'xhigh',
      activeRun: beating({ provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: 'high' }),
    }),
  );
  expect(entry.activeRunSelection).toEqual({ provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: 'high' });
  expect(entry.model).toBe('claude-fable-5-1');
  expect(wire(row()).activeRunSelection).toBeNull();
});

test('the context share divides the newest reading by the point the thread compacts at, and by its window where nothing compacts it', () => {
  expect(wire(row({ contextReading: reading() }), NO_BASIS, COMPACTING).contextShare).toBeCloseTo(0.625);
  expect(wire(row({ contextReading: reading() }), NO_BASIS, WINDOW).contextShare).toBeCloseTo(0.5);
});

test('the context tokens are the prompt the last request sent, with the limit the share divides by, and stand null exactly where the share does', () => {
  expect(wire(row({ contextReading: reading() }), NO_BASIS, COMPACTING).contextTokens).toEqual({ used: 50_000, limit: COMPACTING });
  for (const [contextReading, limit] of [
    [reading({ stale: true }), WINDOW],
    [reading(), null],
    [reading(), { window: 0, compaction: null }],
    [reading({ usage: new Usage({}) }), WINDOW],
    [null, WINDOW],
  ] as const) {
    const entry = wire(row({ contextReading }), NO_BASIS, limit);
    expect(entry.contextShare).toBeNull();
    expect(entry.contextTokens).toBeNull();
  }
});

test('a resting row carries its next request`s warmth, and a running row carries none', () => {
  const measuredAt = new Date(Date.now() - 13 * 60_000).toISOString();
  const promised = wire(
    row({
      provider: 'subscription',
      model: 'claude-opus-5-5',
      contextReading: reading({ provider: 'subscription', model: 'claude-opus-5-5', measuredAt, cache: { ttlSeconds: 3_600 } }),
    }),
  );
  expect(promised.cacheWarmth).toMatchObject({ state: 'warm', basis: 'promise', heldTokens: 50_000 });
  expect(Date.parse(promised.cacheWarmth!.expiresAt!) - Date.parse(measuredAt)).toBe(3_600_000);

  const expired = new Date(Date.now() - 61 * 60_000).toISOString();
  expect(
    wire(
      row({
        provider: 'subscription',
        model: 'claude-opus-5-5',
        contextReading: reading({
          provider: 'subscription',
          model: 'claude-opus-5-5',
          measuredAt: expired,
          cache: { ttlSeconds: 3_600 },
        }),
      }),
    ).cacheWarmth,
  ).toMatchObject({ state: 'cold', basis: 'promise' });

  const curves: WarmthBasis['curves'] = new Map([
    ['openai-oauth', { provider: 'openai-oauth', buckets: [{ gap: '5–15m', sample: 40, warmShare: 0.95, oldestAt: measuredAt }] }],
  ]);
  const rested = new Date(Date.now() - 6 * 60_000).toISOString();
  expect(
    wire(row({ contextReading: reading({ measuredAt: rested, cache: { ttlSeconds: null } }) }), { ...NO_BASIS, curves }).cacheWarmth,
  ).toMatchObject({
    state: 'warm',
    basis: 'local',
    sample: 40,
  });

  expect(wire(row({ status: 'running', activeRun: beating(), contextReading: reading() })).cacheWarmth).toBeNull();
  expect(wire(row()).cacheWarmth).toBeNull();
});

test('a thread naming no account reads cold once its provider`s default moved off the account its reading was signed on', () => {
  const measuredAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const signed = reading({
    provider: 'subscription',
    model: 'claude-opus-5-5',
    account: 'work',
    measuredAt,
    cache: { ttlSeconds: 3_600 },
  });
  const resting = (account: string | null, contextReading = signed) =>
    row({ provider: 'subscription', model: 'claude-opus-5-5', account, contextReading });
  const defaultOn = (account: string): WarmthBasis => ({ ...NO_BASIS, accounts: new Map([['subscription', account]]) });

  expect(wire(resting(null), defaultOn('work')).cacheWarmth).toMatchObject({ state: 'warm', invalidatedBy: null });
  expect(wire(resting(null), defaultOn('personal')).cacheWarmth).toMatchObject({ state: 'cold', invalidatedBy: 'account' });
  expect(wire(resting('work'), defaultOn('personal')).cacheWarmth).toMatchObject({ state: 'warm', invalidatedBy: null });
  expect(wire(resting(null), NO_BASIS).cacheWarmth).toMatchObject({ state: 'warm', invalidatedBy: null });
  const unsigned = reading({ provider: 'subscription', model: 'claude-opus-5-5', measuredAt, cache: { ttlSeconds: 3_600 } });
  expect(wire(resting(null, unsigned), defaultOn('personal')).cacheWarmth).toMatchObject({ state: 'warm', invalidatedBy: null });
});

test('a thread set to another rung than its reading was sent at reads cold, and an unset rung is compared as the rung it resolves to', () => {
  const measuredAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const fallback = MODELS.resolveTextModel('subscription', 'claude-opus-5-5').defaultReasoning;
  const sentAt = (rung: string | null) =>
    reading({ provider: 'subscription', model: 'claude-opus-5-5', reasoning: rung, measuredAt, cache: { ttlSeconds: 3_600 } });
  const resting = (reasoning: string | null, contextReading: ThreadListProjection['contextReading']) =>
    row({ provider: 'subscription', model: 'claude-opus-5-5', reasoning, contextReading });

  expect(wire(resting('xhigh', sentAt('high'))).cacheWarmth).toMatchObject({ state: 'cold', invalidatedBy: 'reasoning' });
  expect(wire(resting('high', sentAt('high'))).cacheWarmth).toMatchObject({ state: 'warm', invalidatedBy: null });
  expect(wire(resting(null, sentAt(fallback))).cacheWarmth).toMatchObject({ state: 'warm', invalidatedBy: null });
});

const TERMINAL_ROAD = { transport: { adapter: 'terminal', profile: 'devin', agent: null }, capabilities: HARNESS_OFFER } as const;

test('a harness row names the CLI it was born to run and the model it reported, and a native row names none', () => {
  const unnamed = {
    name: 'devin',
    presentation: PRESENTATION,
    transport: 'terminal',
    sessionKey: null,
    execution: null,
    observation: unmeasuredObservation(),
  } as const;
  expect(wire(row({ harness: unnamed, provider: 'acme-oauth', model: null, reasoning: null, ...TERMINAL_ROAD })).harness).toEqual({
    name: 'devin',
    presentation: PRESENTATION,
    transport: 'terminal',
    agent: null,
    provider: 'acme-oauth',
    capabilities: HARNESS_OFFER,
    model: null,
    effort: null,
    asked: null,
    execution: null,
    process: null,
    observation: unmeasuredObservation(),
  });
  const observed = {
    ...unmeasuredObservation(),
    revision: 1,
    binding: { sessionId: null, execution: null, rootKey: 'session-7' },
    metadata: {
      ...unmeasuredObservation().metadata,
      model: {
        _tag: 'Value',
        value: 'claude-4.5-sonnet',
        claim: 'serving',
        source: 'hook',
        scope: { rootKey: 'session-7', turnId: null },
        observedAt: '2026-09-13T10:00:00.000Z',
      },
    },
  } as const;
  const running = {
    name: 'cursor',
    presentation: PRESENTATION,
    transport: 'terminal',
    sessionKey: 'session-7',
    execution: { execution: 'e-1', incarnation: 5 },
    observation: observed,
  } as const;
  expect(wire(row({ harness: running, provider: 'external', model: null, reasoning: null, ...TERMINAL_ROAD })).harness).toEqual({
    name: 'cursor',
    presentation: PRESENTATION,
    transport: 'terminal',
    agent: null,
    provider: 'external',
    capabilities: HARNESS_OFFER,
    model: 'claude-4.5-sonnet',
    effort: null,
    asked: null,
    execution: { execution: 'e-1', incarnation: 5 },
    process: null,
    observation: observed,
  });
  expect(wire(row()).harness).toBeNull();
});

test('the asked pair rides beside the reported model, and their disagreement changes neither', () => {
  const reported = {
    ...unmeasuredObservation(),
    revision: 1,
    binding: { sessionId: null, execution: null, rootKey: 'session-9' },
    metadata: {
      ...unmeasuredObservation().metadata,
      model: {
        _tag: 'Value',
        value: 'claude-sonnet-5',
        claim: 'serving',
        source: 'hook',
        scope: { rootKey: 'session-9', turnId: null },
        observedAt: '2026-09-17T10:00:00.000Z',
      },
    },
  } as const;
  const facet = {
    name: 'claude-code',
    presentation: PRESENTATION,
    transport: 'terminal',
    sessionKey: 'session-9',
    execution: null,
    observation: reported,
  } as const;
  const projected = wire(row({ harness: facet, ...TERMINAL_ROAD, model: 'claude-opus-5-5', reasoning: 'high' })).harness;
  expect(projected?.asked).toEqual({ model: 'claude-opus-5-5', reasoning: 'high' });
  expect(projected?.model).toBe('claude-sonnet-5');
});

test('a model the reading cannot stand behind is advertised as none', () => {
  const served = (claim: 'serving' | 'last-recorded', rootKey: string, turnId: string | null) =>
    ({
      _tag: 'Value',
      value: 'sonnet',
      claim,
      source: 'hook',
      scope: { rootKey, turnId },
      observedAt: '2026-09-13T10:00:00.000Z',
    }) as const;
  const harness = (model: ReturnType<typeof served>, bound: string | null) =>
    ({
      name: 'cursor',
      presentation: PRESENTATION,
      transport: 'terminal',
      sessionKey: 'session-7',
      execution: null,
      observation: {
        ...unmeasuredObservation(),
        binding: { sessionId: null, execution: null, rootKey: bound },
        metadata: { ...unmeasuredObservation().metadata, model },
      },
    }) as const;
  expect(wire(row({ harness: harness(served('last-recorded', 'session-7', null), 'session-7') })).harness).toMatchObject({
    model: null,
  });
  expect(wire(row({ harness: harness(served('serving', 'other-root', null), 'session-7') })).harness).toMatchObject({ model: null });
  expect(wire(row({ harness: harness(served('serving', 'session-7', null), null) })).harness).toMatchObject({ model: null });
  expect(wire(row({ harness: harness(served('serving', 'session-7', null), 'session-7') })).harness).toMatchObject({
    model: 'sonnet',
  });
});

test('a full thread list row survives the wire with every key equal', () => {
  const entry: ThreadListRow = {
    id: 'thread-7',
    projectId: 17,
    scopeName: 'a1b2c3d4',
    title: 'wire worker',
    titleOrigin: 'random',
    life: 'working',
    activeRunId: 'run-7',
    activeRunStartedAt: '2026-09-12T18:00:00.000Z',
    activeRunSelection: { provider: 'subscription', model: 'claude-sonnet-5', reasoning: 'high' },
    contextShare: 0.72,
    cacheWarmth: {
      state: 'likely',
      heldTokens: 72_000,
      basis: 'prior',
      expiresAt: null,
      gap: '5–15m',
      warmShare: 0.72,
      sample: 128,
      oldestAt: '2026-09-01T00:00:00.000Z',
      invalidatedBy: null,
    },
    liveSpellStartedAt: '2026-09-12T17:30:00.000Z',
    outcome: {
      runId: 'run-6',
      status: 'failed',
      failureReason: 'the provider closed the stream',
      failure: {
        provider: 'subscription',
        account: 'operator',
        stage: 'RequestExecutor.execute',
        type: 'InvalidRequest',
        httpStatus: 400,
        retryable: false,
        modelStarted: false,
        detail: 'input schema was rejected',
        record: { threadId: 'thread-7', runId: 'run-6', entryId: 'transcript:error:run-6' },
      },
      finishedAt: '2026-09-12T17:00:00.000Z',
      isSeen: true,
      hostStateFailure: false,
    },
    spawnRootId: 'thread-root',
    parentThreadId: 'thread-root',
    bornOf: 'run-root:3',
    name: 'wire-schema',
    agentId: 'harness:cursor',
    profileId: 'profile-7',
    harness: {
      name: 'cursor',
      presentation: PRESENTATION,
      transport: 'terminal',
      agent: null,
      provider: 'external',
      capabilities: NATIVE_CAPABILITIES,
      model: 'claude-4.5-sonnet',
      effort: null,
      asked: null,
      execution: { execution: 'execution-7', incarnation: 5 },
      process: { id: 'session-7', state: 'running', startedAt: '2026-09-12T17:00:00.000Z' },
      observation: unmeasuredObservation(),
    },
    cli: null,
    capabilities: NATIVE_CAPABILITIES,
    phase: {
      phase: 'tools',
      since: 1_757_696_400_000,
      calls: [{ id: 'call-1', name: 'read', title: 'Read protocol.ts', since: 1_757_696_401_000 }],
      queued: [],
    },
    held: { paths: 2, unproven: 0 },
    account: 'operator',
    processAccount: null,
    provider: 'subscription',
    model: 'claude-sonnet-5',
    reasoning: 'high',
    switches: { review: 'strict' },
    createdBySessionId: 42,
    readerOrderAt: '2026-09-12T18:05:00.000Z',
    pinnedAt: '2026-09-12T18:06:00.000Z',
    archivedAt: '2026-09-12T18:07:00.000Z',
    createdAt: '2026-09-12T17:00:00.000Z',
    updatedAt: '2026-09-12T18:08:00.000Z',
  };
  const encoded = Schema.encodeUnknownSync(threadListRowSchema)(entry);
  const decoded = Schema.decodeUnknownSync(threadListRowSchema)(JSON.parse(JSON.stringify(encoded)));
  expect(decoded).toEqual(entry);
});

test('threads born of one act carry one key, another act another, and a thread born of none carries null', () => {
  const reviewer = wire(row({ id: 'reviewer', bornOf: { by: 'run-parent', step: 3 } }));
  const second = wire(row({ id: 'second', bornOf: { by: 'run-parent', step: 3 } }));
  const builder = wire(row({ id: 'builder', bornOf: { by: 'run-parent', step: 4 } }));

  expect(reviewer.bornOf).toBeString();
  expect(reviewer.bornOf).toBe(second.bornOf);
  expect(builder.bornOf).not.toBe(reviewer.bornOf);
  expect(wire(row()).bornOf).toBeNull();
});

test('a thread with nothing standing on it is idle and names no run', () => {
  const entry = wire(row());
  expect(entry.life).toBe('idle');
  expect(entry.activeRunId).toBeNull();
});

test('an open run is working and names its run', () => {
  const entry = wire(row({ status: 'running', activeRun: beating(), life: 'working' }));
  expect(entry.life).toBe('working');
  expect(entry.activeRunId).toBe('run-1');
});

test('a standing run carries its own beginning apart from the tree spell and both row clocks', () => {
  const started = new Date('2026-08-28T09:00:00.000Z');
  const spell = new Date('2026-08-28T08:30:00.000Z');
  const entry = wire(
    row({
      status: 'running',
      readerOrderAt: new Date('2026-08-28T08:00:00.000Z'),
      updatedAt: new Date('2026-08-28T09:30:00.000Z'),
      liveSpellStartedAt: spell,
      activeRun: beating({ startedAt: started }),
      life: 'working',
    }),
  );
  expect(entry.life).toBe('working');
  expect(entry.activeRunStartedAt).toBe(started.toISOString());
  expect(entry.liveSpellStartedAt).toBe(spell.toISOString());
  expect(entry.readerOrderAt).toBe('2026-08-28T08:00:00.000Z');
  expect(entry.updatedAt).toBe('2026-08-28T09:30:00.000Z');
});

test('a thread with nothing standing names no beginning to count from', () => {
  expect(wire(row()).activeRunStartedAt).toBeNull();
});

test('a failure outlives the run that caused it: life idles, the outcome stays', () => {
  const finishedAt = new Date('2026-08-28T10:00:00.000Z');
  const entry = wire(
    row({
      status: 'failed',
      failureReason: 'the provider closed the stream',
      outcome: {
        runId: 'run-1',
        status: 'failed',
        failureReason: 'the provider closed the stream',
        failure: null,
        provider: 'subscription',
        model: 'claude-opus-5-5',
        reasoning: null,
        finishedAt,
        isSeen: false,
        hostStateFailure: false,
      },
    }),
  );
  expect(entry.life).toBe('idle');
  expect(entry.outcome).toEqual({
    runId: 'run-1',
    status: 'failed',
    failureReason: 'the provider closed the stream',
    failure: null,
    finishedAt: finishedAt.toISOString(),
    isSeen: false,
    hostStateFailure: false,
  });
});

test('a typed provider failure crosses the list wire with its safe record address', () => {
  const finishedAt = new Date('2026-08-28T10:00:00.000Z');
  const failure = {
    provider: 'subscription',
    account: null,
    stage: 'RequestExecutor.execute',
    type: 'InvalidRequest',
    httpStatus: 400,
    retryable: false,
    modelStarted: false,
    detail: 'input_schema does not support oneOf at the top level',
    record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
  } as const;
  const entry = wire(
    row({
      status: 'failed',
      outcome: {
        runId: 'run-1',
        status: 'failed',
        failureReason: failure.detail,
        failure,
        provider: 'subscription',
        model: 'claude-opus-5-5',
        reasoning: null,
        finishedAt,
        isSeen: false,
        hostStateFailure: false,
      },
    }),
  );

  expect(entry.outcome?.failure).toEqual(failure);
  expect(
    threadLine({
      id: entry.id,
      title: entry.title,
      status: entry.life,
      model: entry.model,
      updatedAt: entry.updatedAt,
      outcome: entry.outcome,
    }),
  ).toContain('InvalidRequest at RequestExecutor.execute; provider subscription; HTTP 400; not retryable; model execution never started');
});

test('a position addresses a record however the wire spelled it, and an id is never mistaken for one', () => {
  expect(threadRecordAddress(3)).toEqual({ position: 3 });
  expect(threadRecordAddress('3')).toEqual({ position: 3 });
  expect(threadRecordAddress('507')).toEqual({ position: 507 });

  expect(threadRecordAddress('system-prompt:01a05f1b-3681-7e42-8a0d-7ed40c214048')).toEqual({
    recordId: 'system-prompt:01a05f1b-3681-7e42-8a0d-7ed40c214048',
  });
  expect(threadRecordAddress('01a05f1b-371b-7366-986b-0c05dae87d6f')).toEqual({
    recordId: '01a05f1b-371b-7366-986b-0c05dae87d6f',
  });

  expect(threadRecordAddress('0')).toEqual({ recordId: '0' });
  expect(threadRecordAddress('-2')).toEqual({ recordId: '-2' });
  expect(threadRecordAddress('3.5')).toEqual({ recordId: '3.5' });
});

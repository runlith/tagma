import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
import { expect, test } from 'vitest';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { servedProvider } from '$lib/features/providers/testing.js';
import { harnessWords, modelIdentity } from './modelWords.js';

const MODELS = modelCatalog([
  servedProvider({
    id: 'claude-code',
    kind: 'harness',
    auth: 'cli',
    models: {
      'claude-sonnet-5-5': {
        label: 'Claude Sonnet 5.5',
        short: 'Sonnet',
        capacity: { context: 200_000 },
        capabilities: ['text'],
        reasoning: ['high'],
        defaultReasoning: 'high',
      },
    },
    defaultTextModel: 'claude-sonnet-5-5',
  }),
]);

const field = (over: Record<string, unknown> = {}) => ({
  _tag: 'NotRead' as const,
  ...over,
});
const value = (value: string, over: Record<string, unknown> = {}) => ({
  _tag: 'Value' as const,
  value,
  claim: 'serving' as const,
  source: 'hook' as const,
  scope: { rootKey: 'root-1', turnId: null },
  observedAt: '2026-09-13T10:00:00.000Z',
  ...over,
});
const harness = (over: Partial<HarnessRowDetail> & { model?: string | null; effort?: string | null } = {}): HarnessRowDetail =>
  ({
    name: 'cursor',
    presentation: {
      label: 'Cursor',
      iconProvider: null,
      mark: null,
      install: null,
      modelProvider: null,
      terminal: true,
      acp: true,
      hosted: true,
      sharedSessions: false,
    },
    provider: 'external',
    transport: 'acp',
    capabilities: { law: 'every-call', touch: 'reads-and-writes', authorship: 'recorded' },
    model: null,
    effort: null,
    asked: null,
    execution: null,
    question: null,
    process: null,
    observation: {
      binding: { sessionId: null, execution: null, rootKey: null },
      revision: 0,
      metadata: { model: field(), effort: field(), title: field() },
      diagnostics: [],
    },
    ...over,
  }) as HarnessRowDetail;

const row = (harnessRow: HarnessRowDetail | null): ThreadListRow =>
  ({
    id: 'thread-1',
    projectId: 1,
    scopeName: null,
    title: 'work',
    titleOrigin: 'random',
    life: 'idle',
    activeRunId: null,
    activeRunStartedAt: null,
    activeRunSelection: null,
    contextShare: null,
    cacheWarmth: null,
    liveSpellStartedAt: null,
    outcome: null,
    spawnRootId: 'thread-1',
    parentThreadId: null,
    name: null,
    agentId: 'harness',
    profileId: null,
    harness: harnessRow,
    phase: null,
    held: { paths: 0, unproven: 0 },
    account: null,
    provider: 'external',
    model: null,
    reasoning: null,
    switches: {},
    createdBySessionId: null,
    readerOrderAt: '2026-09-13T10:00:00.000Z',
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
  }) as ThreadListRow;

test('a current model and effort read as current', () => {
  const words = harnessWords(
    MODELS,
    harness({
      model: 'sonnet',
      effort: 'high',
      observation: {
        binding: { sessionId: 's-1', execution: { execution: 'e-1', incarnation: 1 }, rootKey: 'root-1' },
        revision: 1,
        metadata: {
          model: value('sonnet'),
          effort: value('high', { source: 'transcript' }),
          title: field(),
        },
        diagnostics: [],
      },
    }),
  );
  expect(words.label).toBe('Cursor');
  expect(words.model).toMatchObject({ value: 'sonnet', current: true });
  expect(words.effort).toMatchObject({ value: 'high', current: true });
  expect(modelIdentity(MODELS, row(harness({ model: 'sonnet', effort: 'high' })))).toBe('Cursor · sonnet · high');
});

test('a last-known model reads as last known, never as current', () => {
  const words = harnessWords(
    MODELS,
    harness({
      observation: {
        binding: { sessionId: 's-1', execution: { execution: 'e-1', incarnation: 1 }, rootKey: 'root-1' },
        revision: 2,
        metadata: {
          model: {
            _tag: 'Stale',
            lastKnown: {
              value: 'sonnet',
              claim: 'serving',
              source: 'hook',
              scope: { rootKey: 'root-1', turnId: null },
              observedAt: '2026-09-13T10:01:00.000Z',
              why: 'authority-lapsed',
            },
          },
          effort: field(),
          title: field(),
        },
        diagnostics: [],
      },
    }),
  );
  expect(words.model).toMatchObject({ value: 'sonnet', current: false });
  expect(words.effort.value).toBeNull();
});

test('the asked pair stands from the first second', () => {
  const waiting = harnessWords(MODELS, harness({ asked: { model: 'swe-2', reasoning: 'max' } }));
  expect(waiting.model).toMatchObject({ value: 'swe-2', current: true });
  expect(waiting.effort).toMatchObject({ value: 'max', current: true });

  const answered = harnessWords(
    MODELS,
    harness({
      asked: { model: 'swe-2', reasoning: 'max' },
      model: 'SWE-2 Max',
      observation: {
        ...harness().observation,
        revision: 1,
        metadata: { model: value('SWE-2 Max', { source: 'transcript' }), effort: field(), title: field() },
      },
    }),
  );
  expect(answered.model.value).toBe('swe-2');

  const rungless = harnessWords(
    MODELS,
    harness({
      asked: { model: 'swe-2', reasoning: null },
      effort: 'high',
      observation: {
        ...harness().observation,
        revision: 1,
        metadata: { model: field(), effort: value('high', { source: 'hook' }), title: field() },
      },
    }),
  );
  expect(rungless.model.value).toBe('swe-2');
  expect(rungless.effort).toMatchObject({ value: 'high', current: true });
});

test('a harness serving a catalog row names its model the way the catalog does; one outside it keeps its own id', () => {
  expect(
    harnessWords(
      MODELS,
      harness({ name: 'claude-code', provider: 'claude-code', asked: { model: 'claude-sonnet-5-5', reasoning: 'high' } }),
    ).short,
  ).toBe('Sonnet');
  expect(harnessWords(MODELS, harness({ name: 'cursor', model: 'composer-2' })).short).toBe('composer-2');
});

test('an unreadable field keeps its reason and its last value', () => {
  const words = harnessWords(
    MODELS,
    harness({
      observation: {
        binding: { sessionId: 's-1', execution: { execution: 'e-1', incarnation: 1 }, rootKey: 'root-1' },
        revision: 1,
        metadata: {
          model: {
            _tag: 'Unreadable',
            source: 'transcript',
            scope: { rootKey: 'root-1', turnId: null },
            observedAt: '2026-09-13T10:02:00.000Z',
            reason: 'the store could not be opened',
            lastKnown: null,
          },
          effort: field(),
          title: field(),
        },
        diagnostics: [],
      },
    }),
  );
  expect(words.model.value).toBeNull();
  expect(words.model.detail).toContain('the store could not be opened');
});

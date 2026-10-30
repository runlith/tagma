import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { CACHE_CURVE_SAMPLE, type ThreadCacheObservationValues } from '@runlith/agent/thread/storage/cacheObservations';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { makeCacheObservationStore } from './cacheObservations.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadFolder } from '../testing/fold.js';
import { CORE_KINDS, threadStore } from '../testing/doubles.js';

const machine = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const stand = Effect.gen(function* () {
  const threads = yield* threadStore(yield* makeThreadRecords, CORE_KINDS);
  const row = yield* Effect.acquireRelease(threads.insert({ ownerId: 'owner-1', agentId: 'tagma' }), (row) =>
    threads.delete([row.id]).pipe(Effect.orDie),
  );
  return { row, fold: yield* threadFolder(threads), observations: yield* makeCacheObservationStore };
});

const observed = (stepNumber: number, gapMs: number, provider = 'subscription'): ThreadCacheObservationValues => ({
  runId: 'run-1',
  stepNumber,
  provider,
  model: 'claude-opus-5-5',
  sentAt: '2026-09-10T10:07:30.000Z',
  gapMs,
  inputTokens: 120_000,
  cacheReadTokens: 110_000,
});

layer(machine)('cache observations', (it) => {
  it.effect('an atomic patch lands its observations under the thread, read back by provider and bucket, newest first', () =>
    Effect.gen(function* () {
      const { row, fold, observations } = yield* stand;
      yield* fold(row.id, () =>
        Effect.succeed({ cacheObservations: [observed(1, 420_000), observed(2, 30_000), observed(3, 500_000, 'openai-oauth')] }),
      );

      const read = yield* observations.latest(['subscription', 'openai-oauth', 'acme-oauth'], 10);
      expect(read.filter((observation) => observation.provider === 'subscription')).toEqual([
        expect.objectContaining({ threadId: row.id, stepNumber: 2, gapMs: 30_000 }),
        expect.objectContaining({ threadId: row.id, stepNumber: 1, gapMs: 420_000 }),
      ]);
      expect(read.filter((observation) => observation.provider === 'openai-oauth')).toEqual([
        expect.objectContaining({ threadId: row.id, stepNumber: 3, gapMs: 500_000 }),
      ]);
      expect(read.some((observation) => observation.provider === 'acme-oauth')).toBe(false);
      expect(yield* observations.latest([], 10)).toEqual([]);
    }),
  );

  it.effect('the writer keeps the newest sample of a provider and bucket and drops the rows past it', () =>
    Effect.gen(function* () {
      const { row, fold, observations } = yield* stand;
      const extra = 5;
      yield* fold(row.id, () =>
        Effect.succeed({
          cacheObservations: Array.from({ length: CACHE_CURVE_SAMPLE + extra }, (_, index) => observed(index, 3_700_000, 'acme-oauth')),
        }),
      );

      const kept = yield* observations.latest(['acme-oauth'], CACHE_CURVE_SAMPLE * 2);
      expect(kept).toHaveLength(CACHE_CURVE_SAMPLE);
      expect(kept[0]?.stepNumber).toBe(CACHE_CURVE_SAMPLE + extra - 1);
      expect(kept.at(-1)?.stepNumber).toBe(extra);
    }),
  );

  it.effect('the read caps each provider and bucket at the limit asked for, whatever the table holds', () =>
    Effect.gen(function* () {
      const { row, fold, observations } = yield* stand;
      yield* fold(row.id, () =>
        Effect.succeed({
          cacheObservations: [
            ...Array.from({ length: 6 }, (_, index) => observed(index, 2_000, 'example-oauth')),
            ...Array.from({ length: 6 }, (_, index) => observed(100 + index, 5_000_000, 'example-oauth')),
          ],
        }),
      );

      const capped = yield* observations.latest(['example-oauth'], 2);
      expect(capped.filter((observation) => observation.gapMs === 2_000).map((observation) => observation.stepNumber)).toEqual([5, 4]);
      expect(capped.filter((observation) => observation.gapMs === 5_000_000).map((observation) => observation.stepNumber)).toEqual([
        105, 104,
      ]);
    }),
  );

  it.effect('a quiet bucket answers from behind more rows than a bounded read takes', () =>
    Effect.gen(function* () {
      const { row, fold, observations } = yield* stand;
      yield* fold(row.id, () =>
        Effect.succeed({
          cacheObservations: [
            ...Array.from({ length: 3 }, (_, index) => observed(200 + index, 5_000_000, 'sample-oauth')),
            ...Array.from({ length: 20 }, (_, index) => observed(index, 2_000, 'sample-oauth')),
          ],
        }),
      );

      const read = yield* observations.latest(['sample-oauth'], 2);
      expect(read.filter((observation) => observation.gapMs === 2_000).map((observation) => observation.stepNumber)).toEqual([19, 18]);
      expect(read.filter((observation) => observation.gapMs === 5_000_000).map((observation) => observation.stepNumber)).toEqual([
        202, 201,
      ]);
    }),
  );
});

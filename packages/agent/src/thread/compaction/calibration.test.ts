import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ThreadCalibrationSaveFailed, ThreadTokenCalibration, measuredWeight } from './calibration';
describe('ThreadTokenCalibration persistence', () => {
  it.effect(
    'what one process learned and persisted, the next one starts from',
    Effect.fnUntraced(function* () {
      const disk = store();
      const first = new ThreadTokenCalibration({ store: disk });
      first.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 1_600);
      const learned = first.weight('openai-oauth', 'gpt-5.6-sol');
      expect(learned).toBeGreaterThan(1.1);
      expect(disk.load()).toBeUndefined();
      yield* first.persist();
      const second = new ThreadTokenCalibration({ store: disk });
      expect(second.weight('openai-oauth', 'gpt-5.6-sol')).toBe(learned);
    }),
  );
  it.effect(
    'observations a failed save left behind are saved by the next persist',
    Effect.fnUntraced(function* () {
      const disk = store({ failures: 1 });
      const calibration = new ThreadTokenCalibration({ store: disk });
      calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 1_600);
      expect(yield* Effect.flip(calibration.persist())).toBeInstanceOf(ThreadCalibrationSaveFailed);
      yield* calibration.persist();
      expect(Object.keys(disk.load() ?? {})).toEqual(['openai-oauth/gpt-5.6-sol']);
    }),
  );
  test('a host that stores nothing keeps its weights for the process alone', () => {
    const calibration = new ThreadTokenCalibration();
    calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 1_600);
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBeGreaterThan(1);
  });
});
describe('ThreadTokenCalibration weight', () => {
  test('a switched model is corrected by its own coefficient, never by its neighbour', () => {
    const calibration = new ThreadTokenCalibration();
    calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 1_600);
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBeGreaterThan(1.1);
    expect(calibration.weight('subscription', 'claude-opus-5')).toBe(1);
  });
  test('a measured request weighs its thread by its own ratio, held within the clamp, and nothing measured weighs nothing', () => {
    expect(measuredWeight({ measured: 551_612, covered: 732_000, estimated: 4_000 })).toBeCloseTo(0.754, 3);
    expect(measuredWeight({ measured: 639_480, covered: 10, estimated: 4_000 })).toBe(2);
    expect(measuredWeight({ measured: 0, covered: 0, estimated: 4_000 })).toBeNull();
  });
});
describe('ThreadTokenCalibration baseline', () => {
  test('an unobserved pair corrects by the measured baseline, and learning moves from it', () => {
    const calibration = new ThreadTokenCalibration({
      baseline: (provider, model) => (provider === 'openai-oauth' && model === 'gpt-5.6-sol' ? 1.5 : undefined),
    });
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBe(1.5);
    expect(calibration.weight('subscription', 'claude-opus-5')).toBe(1);
    calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 2_000);
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBeGreaterThan(1.5);
  });
  test('a baseline outside the clamp is refused, exactly as a stored weight is', () => {
    const calibration = new ThreadTokenCalibration({ baseline: () => 8 });
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBe(1);
  });
  it.effect(
    'what this installation learned outranks the baseline',
    Effect.fnUntraced(function* () {
      const disk = store();
      const learner = new ThreadTokenCalibration({ store: disk, baseline: () => 1.5 });
      learner.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 800);
      const learned = learner.weight('openai-oauth', 'gpt-5.6-sol');
      expect(learned).toBeLessThan(1.5);
      yield* learner.persist();
      const next = new ThreadTokenCalibration({ store: disk, baseline: () => 1.5 });
      expect(next.weight('openai-oauth', 'gpt-5.6-sol')).toBe(learned);
    }),
  );
});
function store(
  options: {
    failures?: number;
  } = {},
) {
  let saved: Record<string, number> | undefined;
  let failures = options.failures ?? 0;
  return {
    load: () => saved,
    save: (weights: Record<string, number>) =>
      Effect.suspend(() => {
        if (failures > 0) {
          failures -= 1;
          return Effect.fail(new ThreadCalibrationSaveFailed({ cause: new Error('the disk is full') }));
        }
        saved = weights;
        return Effect.void;
      }),
  };
}

import { describe, expect, test } from 'bun:test';
import { estimateThreadTokens } from '../measurement';
import { baselineWeight, CONTEXT_CORPUS, CORPUS_MEASUREMENTS, corpusBaseline, type CorpusMeasurement } from './index';

describe('the context corpus', () => {
  test('every shape that tokenizes differently is present, and each is measurable', () => {
    const ids = CONTEXT_CORPUS.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of CONTEXT_CORPUS) {
      expect(estimateThreadTokens(fixture.request)).toBeGreaterThan(0);
      expect(fixture.measures.length).toBeGreaterThan(10);
    }
  });

  test('the corpus carries no conversation, only shapes this repository owns', () => {
    const text = JSON.stringify(CONTEXT_CORPUS);
    expect(text).not.toContain('@');
    expect(text.length).toBeGreaterThan(1_000);
  });

  test('measurements imply the weight a fresh install should start from', () => {
    const measurements: CorpusMeasurement[] = CONTEXT_CORPUS.map((fixture) => ({
      fixtureId: fixture.id,
      provider: 'openai-oauth',
      model: 'gpt-5.6-sol',
      reportedInputTokens: Math.round(estimateThreadTokens(fixture.request) * 1.5),
    }));

    const weight = baselineWeight(measurements, (fixture) => estimateThreadTokens(fixture.request));
    expect(weight).toBeCloseTo(1.5, 2);
  });

  test('no measurements at all imply nothing, rather than a weight of one', () => {
    expect(baselineWeight([], (fixture) => estimateThreadTokens(fixture.request))).toBeUndefined();
  });

  test('the baseline answers per pair, and only for pairs that were measured', () => {
    const measurements: CorpusMeasurement[] = CONTEXT_CORPUS.map((fixture) => ({
      fixtureId: fixture.id,
      provider: 'openai-oauth',
      model: 'gpt-5.6-sol',
      reportedInputTokens: Math.round(estimateThreadTokens(fixture.request) * 1.5),
    }));

    const baseline = corpusBaseline(measurements);
    expect(baseline('openai-oauth', 'gpt-5.6-sol')).toBeCloseTo(1.5, 2);
    expect(baseline('openai-oauth', 'gpt-5.6-luna')).toBeUndefined();
    expect(baseline('subscription', null)).toBeUndefined();
  });

  test('the shipped measurements are what a fresh installation actually starts from', () => {
    const shipped = corpusBaseline();
    for (const measurement of CORPUS_MEASUREMENTS) {
      expect(shipped(measurement.provider, measurement.model)).toBeGreaterThan(0);
    }
    expect(shipped('a-provider-nobody-measured', 'a-model-nobody-measured')).toBeUndefined();
  });
});

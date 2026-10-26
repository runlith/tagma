import { afterEach, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ThreadTokenCalibration } from '@runlith/agent/thread/compaction/calibration';
import { calibrationProfiles } from './calibration.js';

describe('calibration profiles', () => {
  const homes: string[] = [];
  const home = () => {
    const path = mkdtempSync(join(tmpdir(), 'tagma-calibration-'));
    homes.push(path);
    return path;
  };

  afterEach(() => {
    for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it.effect('what one process learned and closed with is what the next one starts from', () =>
    Effect.gen(function* () {
      const path = join(home(), 'threads', 'calibration.json');
      const first = new ThreadTokenCalibration({ store: calibrationProfiles(path) });
      for (let round = 0; round < 12; round += 1) first.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 1_600);
      expect(() => readFileSync(path, 'utf8')).toThrow();

      yield* first.persist();

      const second = new ThreadTokenCalibration({ store: calibrationProfiles(path) });
      expect(second.weight('openai-oauth', 'gpt-5.6-sol')).toBe(first.weight('openai-oauth', 'gpt-5.6-sol'));
    }),
  );

  it.effect('a profile written under a version prefix is migrated once: the current weights lose the prefix, the others are dropped', () =>
    Effect.gen(function* () {
      const path = join(home(), 'calibration.json');
      writeFileSync(path, JSON.stringify({ '5/openai-oauth/gpt-5.6-sol': 1.42, '4/openai-oauth/gpt-5.6-luna': 1.9 }));

      const calibration = new ThreadTokenCalibration({ store: calibrationProfiles(path) });
      yield* calibration.persist();

      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'openai-oauth/gpt-5.6-sol': 1.42 });
      expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBe(1.42);
    }),
  );

  it('an absent, corrupt or non-numeric profile leaves the estimate uncorrected', () => {
    expect(calibrationProfiles(join(home(), 'nothing-here.json')).load()).toBeUndefined();

    const corrupt = join(home(), 'calibration.json');
    writeFileSync(corrupt, '{ this is not json');
    expect(calibrationProfiles(corrupt).load()).toBeUndefined();

    const lying = join(home(), 'lying.json');
    writeFileSync(lying, JSON.stringify({ 'openai-oauth/gpt-5.6-sol': 'heavy' }));
    expect(calibrationProfiles(lying).load()).toEqual({});
  });
});

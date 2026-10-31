import { expect, test } from 'bun:test';
import type { ThreadFormRecord } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../composed.js';

const records: readonly ThreadFormRecord[] = ['entry', 'payload', 'message', 'reading', 'meta', 'inbox'];

for (const step of ENTRY_KINDS.steps)
  test(`${step.name} forms its declared samples into fixed points`, () => {
    const transformed = records.filter((record) => step[record] !== undefined);
    expect(transformed.length).toBeGreaterThan(0);
    for (const record of transformed) {
      const sample = step.samples[record];
      expect(sample).toBeDefined();
      if (sample === undefined) throw new Error(`${step.name} has no ${record} sample`);
      const before = structuredClone(sample);
      const formed = step[record]!(before);
      expect(formed).not.toBeNull();
      expect(before).toEqual(sample);
      if (formed === null) throw new Error(`${step.name}'s ${record} sample is already current`);
      expect(step[record]!(formed) ?? formed).toEqual(formed);
    }
  });

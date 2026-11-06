import { expect, test } from 'bun:test';
import type { ThreadFormRecord } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../composed.js';

const records: readonly ThreadFormRecord[] = ['entry', 'payload', 'message', 'reading', 'meta', 'inbox'];

const DECLARED_BACK = '20261105180000_ask_partial';

for (const step of ENTRY_KINDS.steps)
  test(`${step.name} forms its declared samples into fixed points, and its back form returns them`, () => {
    const transformed = records.filter((record) => step[record] !== undefined);
    expect(transformed.length).toBeGreaterThan(0);
    if (step.name > DECLARED_BACK) expect(step.back).toBeDefined();
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
      const back = step.back?.[record];
      if (back === undefined) continue;
      expect((step.back!.holds ?? []).some((text) => JSON.stringify(formed).includes(text))).toBe(true);
      const held = structuredClone(formed);
      const returned = back(held) ?? held;
      expect(held).toEqual(formed);
      expect(back(returned) ?? returned).toEqual(returned);
      expect(step[record]!(returned) ?? returned).toEqual(formed);
    }
  });

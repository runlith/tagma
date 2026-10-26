import { describe, expect, test } from 'bun:test';
import type { LawEnforcement } from '../../graph/contract/wire/enforcement.js';
import { documentRevision, revisionOf } from './revision.js';

const standing: LawEnforcement = {
  strictness: 'gate',
  on: [{ op: 'submit_work', phase: 'before' }],
  inspection: 'size',
  debt: [],
  escaped: [],
};

describe('the revision enforce_rule takes as base', () => {
  test('a re-measure that retires debt leaves it, so a caller built on the list still writes', () => {
    const remeasured: LawEnforcement = { ...standing, debt: [{ fingerprint: 'F4 core/a.ts', owner: 'task' }] };
    expect(documentRevision(remeasured)).toBe(documentRevision(standing));
  });

  test("a peer's change of the inspection key moves it, so an input built before the change refuses", () => {
    expect(documentRevision({ ...standing, inspection: 'size-core' })).not.toBe(documentRevision(standing));
  });

  test('no document standing reads null, and a document that does not decode still has one', () => {
    expect(revisionOf(undefined, undefined)).toBeNull();
    expect(revisionOf(undefined, { strictness: 'gate', unknown: 2 })).toEqual(expect.any(String));
  });
});

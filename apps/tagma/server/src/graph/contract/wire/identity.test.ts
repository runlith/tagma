import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { mintBlockId, mintedAt, resolveSpokenId, spokenIds } from './identity.js';
import { SPOKEN_LENGTH, spokenId } from '../../../platform/contract/wire/ids.js';

const ids = ['0198c3d4-0000-7000-8000-00000000ffaa', '0198c3d4-0000-7000-8000-11111111ffaa'];

describe('block identity', () => {
  test('a minted id is a uuidv7 and its spoken form is the random tail', () => {
    const id = mintBlockId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(spokenId(id)).toHaveLength(SPOKEN_LENGTH);
    expect(id.replaceAll('-', '').endsWith(spokenId(id))).toBe(true);
  });

  test('spokenId cuts the suffix of a fixed uuid deterministically', () => {
    expect(spokenId('0198c3d4-7b2a-7f00-8000-3f9ac2b41e77')).toBe('c2b41e77');
  });

  test('a corpus with a suffix collision extends both suffixes until unique', () => {
    const a = '0198c3d4-0000-7000-8000-111100c0ffee';
    const b = '0198c3d4-0000-7000-8000-222200c0ffee';
    const c = '0198c3d4-0000-7000-8000-2222deadbeef';
    const spoken = spokenIds([a, b, c]);
    expect(spoken.get(c)).toBe('deadbeef');
    expect(spoken.get(a)).toBe('111100c0ffee');
    expect(spoken.get(b)).toBe('222200c0ffee');
  });

  it.effect('a suffix resolves only a unique identity and otherwise refuses with its condition', () =>
    Effect.gen(function* () {
      expect(yield* resolveSpokenId(spokenId(ids[0]!), ids)).toBe(ids[0]!);
      const ambiguous = yield* Effect.flip(resolveSpokenId('ffaa', ids));
      expect(ambiguous.reason).toBe('ambiguous');
      expect(ambiguous.candidates).toEqual(ids);
      expect((yield* Effect.flip(resolveSpokenId('deadbeef', ids))).reason).toBe('not-found');
      expect((yield* Effect.flip(resolveSpokenId('', ids))).reason).toBe('invalid');
      expect((yield* Effect.flip(resolveSpokenId('not-hex!', ids))).reason).toBe('invalid');
    }),
  );
});

test('a block id carries the millisecond it was minted at, and an id that is not a uuidv7 carries none', () => {
  const at = Date.UTC(2026, 8, 29, 16, 0, 0, 123);
  const hex = at.toString(16).padStart(12, '0');
  const id = `${hex.slice(0, 8)}-${hex.slice(8)}-7abc-8def-0123456789ab`;
  expect(mintedAt(id)?.getTime()).toBe(at);
  expect(mintedAt(mintBlockId())?.getTime()).toBeLessThanOrEqual(Date.now());
  expect(mintedAt('01a0e470-ffc4-4261-8631-2ffbf7e0b9dd')).toBeNull();
  expect(mintedAt('not-an-id')).toBeNull();
});

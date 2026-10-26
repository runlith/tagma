import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { shelfNames } from '../../tree/layout.js';
import { resolveSpokenId, spokenIds } from './identity.js';
import { SPOKEN_LENGTH, spokenId } from '../../../platform/contract/wire/ids.js';

const ids = ['0198aaaa-0000-7000-8000-aaaaaaaaaaaa', '0198bbbb-0000-7000-8000-aaaaaaaaaaaa', '0198cccc-0000-7000-8000-aaaaaaaaaaaa'];

describe('adversarial suffix collisions', () => {
  it.effect('ids sharing a long tail earn distinct resolvable suffixes of at least the spoken length', () =>
    Effect.gen(function* () {
      const spoken = spokenIds(ids);
      expect(new Set(spoken.values()).size).toBe(ids.length);
      for (const [id, suffix] of spoken) {
        expect(id.replaceAll('-', '').endsWith(suffix)).toBe(true);
        expect(suffix.length).toBeGreaterThanOrEqual(SPOKEN_LENGTH);
        expect(yield* resolveSpokenId(suffix, ids)).toBe(id);
      }
    }),
  );

  it.effect('resolving the shared short tail refuses as ambiguous, naming every candidate', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(resolveSpokenId('aaaaaaaaaaaaaaaa'.slice(-SPOKEN_LENGTH), ids));
      expect(failure.reason).toBe('ambiguous');
      expect(failure.candidates).toEqual(ids);
    }),
  );

  test('same-title siblings all earn distinct file names and one keeps the bare name', () => {
    const rows = ids.map((id, ord) => ({ id, title: 'Meeting Notes', ord }));
    const names = shelfNames(rows);
    expect(new Set(names.values()).size).toBe(rows.length);
    expect([...names.values()].filter((name) => name === 'meeting-notes')).toHaveLength(1);
  });

  it.effect('case and dashes never change what a spoken reference means', () =>
    Effect.gen(function* () {
      const id = ids[0]!;
      const suffix = spokenId(id);
      expect(yield* resolveSpokenId(suffix.toUpperCase(), [id])).toBe(id);
      expect(yield* resolveSpokenId(`${suffix.slice(0, 4)}-${suffix.slice(4)}`, [id])).toBe(id);
    }),
  );

  it.effect('a full uuid resolves as its own longest suffix', () =>
    Effect.gen(function* () {
      const id = ids[1]!;
      expect(yield* resolveSpokenId(id.replaceAll('-', ''), ids)).toBe(id);
    }),
  );
});

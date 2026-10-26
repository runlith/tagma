// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { Claims, KeyedClaims } from './Claims.svelte.js';

test('a holder torn down after its replacement took the place in the same flush leaves the place to the replacement', () => {
  const claims = new Claims<string>();
  const keyed = new KeyedClaims<string, string>();
  const leaving = $effect.root(() => {
    const released = [claims.take('old'), keyed.take('seat', 'old')];
    return () => released.forEach((release) => release());
  });
  flushSync();

  flushSync(() => {
    claims.take('new');
    keyed.take('seat', 'new');
    leaving();
  });

  expect([claims.current, keyed.get('seat')]).toEqual(['new', 'new']);
});

import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

describe('an effect that writes what it just read and flushes in the same run', () => {
  it('runs to its end instead of throwing from the scheduler', () => {
    let reveal: () => void = () => undefined;
    let seen: number | undefined;

    const stop = $effect.root(() => {
      let shown = $state(false);
      reveal = () => {
        shown = true;
      };

      $effect(() => {
        if (!shown) return;
        let x = $state(0);
        $effect(() => {
          if (x === 0) {
            x = 1;
            flushSync();
          }
          seen = x;
        });
      });
    });

    flushSync();
    reveal();
    expect(() => flushSync()).not.toThrow();
    expect(seen).toBe(1);
    stop();
  });
});

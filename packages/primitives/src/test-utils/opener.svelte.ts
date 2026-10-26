import { flushSync } from 'svelte';

export function opener(ask: () => void): {
  readonly runs: number;
  readonly failure: unknown;
  settle: () => void;
  stop: () => void;
} {
  let runs = 0;
  let failure: unknown;

  const stop = $effect.root(() => {
    $effect(() => {
      runs += 1;
      ask();
    });
  });

  const settle = (): void => {
    try {
      flushSync();
    } catch (error) {
      failure ??= error;
    }
  };

  settle();

  return {
    get runs() {
      return runs;
    },
    get failure() {
      return failure;
    },
    settle,
    stop,
  };
}

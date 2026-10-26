import { flushSync } from 'svelte';
import { withoutReactiveContext } from './detach.js';
import { describe, expect, it } from 'vitest';

function service(root: (build: () => void) => () => void) {
  let runs = 0;
  let bump: (value: number) => void = () => undefined;

  const stop = root(() => {
    let value = $state.raw(0);
    bump = (next) => {
      value = next;
    };
    $effect(() => {
      void value;
      runs += 1;
    });
  });

  return {
    stop,
    bump: (value: number) => bump(value),
    get runs() {
      return runs;
    },
  };
}

describe('a service root built from inside a foreign effect', () => {
  it('keeps reacting when the graph detaches it', () => {
    let built: ReturnType<typeof service> | undefined;
    let drop: () => void = () => undefined;

    const stopHost = $effect.root(() => {
      let alive = $state.raw(true);
      drop = () => {
        alive = false;
      };

      $effect(() => {
        if (!alive) return;
        built ??= service((build) => withoutReactiveContext(() => $effect.root(build)));
        built.bump(1);
      });
    });

    flushSync();
    const service_ = built;
    if (!service_) throw new Error('the service was never built');
    expect(service_.runs).toBe(1);

    drop();
    flushSync();

    service_.bump(2);
    flushSync();
    expect(service_.runs).toBe(2);

    service_.stop();
    stopHost();
  });
});

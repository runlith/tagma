import { flush } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Clock } from '../clock.js';
import { UnknownServiceError } from '../Graph.js';
import { Service } from '../key.js';
import { Layer, type AnyLayer } from '../Layer.js';
import { FinalizerError, Scope } from '../Scope.js';
import { Visitor } from '../testing.js';
import { test as mountApp } from './test.svelte.js';

class Gate extends Service<Gate>()('Lifetime.Gate', { tier: 'app' }) {
  on = $state(true);
}

function mount(layer: AnyLayer, gate: Gate, failures: unknown[] = []) {
  return mountApp(Layer.mergeAll(layer), Layer.of(Gate, gate), {
    ladder: [Visitor],
    at: { visitor: Visitor.guest() },
    data: 'lazy',
    onFailure: (error) => failures.push(error),
  });
}

function flip(gate: Gate, on: boolean): void {
  gate.on = on;
  flushSync();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a service its condition takes back', () => {
  it('ends its whole lifetime: its timer stops, its signal aborts, its finalizers run', async () => {
    vi.useFakeTimers();
    const seen = { ticks: 0, aborted: false, finalized: false };
    class Poller extends Service<Poller>()('Lifetime.Poller', { tier: 'app', eager: true }) {
      static *make() {
        const scope = yield* Scope;
        Clock.every(scope, 5, () => void (seen.ticks += 1));
        scope.signal.addEventListener('abort', () => void (seen.aborted = true));
        scope.defer(() => void (seen.finalized = true));
        return new Poller();
      }
    }
    const gate = new Gate();
    const rt = mount(
      Layer.when(Gate, (g) => g.on, Poller),
      gate,
    );
    await vi.advanceTimersByTimeAsync(5);
    expect(seen.ticks).toBeGreaterThan(0);

    flip(gate, false);
    const atEnd = seen.ticks;
    await vi.advanceTimersByTimeAsync(10);

    expect(seen).toEqual({ ticks: atEnd, aborted: true, finalized: true });
    await rt.unmount();
  });

  it('leaves nothing behind in its owner, however often it comes and goes', async () => {
    class Caller extends Service<Caller>()('Lifetime.Caller', { tier: 'app', eager: true }) {
      static make(): Caller {
        return new Caller();
      }
    }
    const gate = new Gate();
    const rt = mount(
      Layer.when(Gate, (g) => g.on, Caller),
      gate,
    );
    await flush();
    const held = rt.app.app.finalizers.length;

    for (let round = 0; round < 50; round += 1) {
      flip(gate, false);
      flip(gate, true);
    }

    expect(rt.app.app.finalizers.length).toBe(held);
    expect(rt.get(Caller)).toBeInstanceOf(Caller);
    await rt.unmount();
  });

  it('reports a finalizer that throws to the failure reader, and is taken back all the same', async () => {
    class Fragile extends Service<Fragile>()('Lifetime.Fragile', { tier: 'app', eager: true }) {
      static *make() {
        const scope = yield* Scope;
        scope.defer(() => {
          throw new Error('finalizer failed');
        });
        return new Fragile();
      }
    }
    const gate = new Gate();
    const failures: unknown[] = [];
    const rt = mount(
      Layer.when(Gate, (g) => g.on, Fragile),
      gate,
      failures,
    );
    await flush();

    expect(() => flip(gate, false)).not.toThrow();
    await flush();

    expect(failures).toEqual([expect.any(FinalizerError)]);
    expect(((failures[0] as FinalizerError).cause as Error).message).toBe('finalizer failed');
    expect(() => rt.get(Fragile)).toThrow(UnknownServiceError);
    await rt.unmount();
  });

  it('goes newest first: a dependent ends before what it was built from', async () => {
    const trace: string[] = [];
    class Base extends Service<Base>()('Lifetime.Base', { tier: 'app', eager: true }) {
      static *make() {
        (yield* Scope).defer(() => void trace.push('stop:Base'));
        return new Base();
      }
    }
    class Dependent extends Service<Dependent>()('Lifetime.Dependent', { tier: 'app', eager: true }) {
      static *make() {
        yield* Base;
        (yield* Scope).defer(() => void trace.push('stop:Dependent'));
        return new Dependent();
      }
    }
    const gate = new Gate();
    const rt = mount(
      Layer.when(Gate, (g) => g.on, Layer.mergeAll(Base, Dependent)),
      gate,
    );
    await flush();

    flip(gate, false);
    await flush();

    expect(trace).toEqual(['stop:Dependent', 'stop:Base']);
    await rt.unmount();
  });
});

describe('a make that fails', () => {
  it('closes what it deferred at once and leaves nothing in its owner, attempt after attempt', async () => {
    const disposed: string[] = [];
    class HalfBuilt extends Service<HalfBuilt>()('Lifetime.HalfBuilt', { tier: 'app' }) {
      static *make() {
        const scope = yield* Scope;
        scope.defer(() => void disposed.push('disposed'));
        throw new Error('make failed after defer');
      }
    }
    const rt = mount(Layer.mergeAll(HalfBuilt), new Gate());
    const held = rt.app.app.finalizers.length;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(() => rt.get(HalfBuilt)).toThrow('make failed after defer');
      expect(disposed).toHaveLength(attempt);
    }
    expect(rt.app.app.finalizers.length).toBe(held);
    await rt.unmount();
    expect(disposed).toHaveLength(3);
  });
});

describe('the scope a make receives', () => {
  it('is the instance’s own lifetime inside the rung scope that hosts it', async () => {
    class Resident extends Service<Resident>()('Lifetime.Resident', { tier: 'guest' }) {
      static *make() {
        return new Resident(yield* Scope);
      }
      constructor(readonly scope: Scope) {
        super();
      }
    }
    const rt = mount(Layer.mergeAll(Resident), new Gate());
    const { scope } = rt.get(Resident);
    const visitor = rt.app.scopeOf('visitor');

    expect(scope.parent).toBe(visitor);
    expect(scope.home).toBe(visitor);
    expect(scope.home.kind).toBe('guest');
    await rt.unmount();
    expect(scope.closed).toBe(true);
  });
});

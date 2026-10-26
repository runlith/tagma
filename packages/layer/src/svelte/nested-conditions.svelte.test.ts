import { flush } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

import { LayerTierError, UnknownServiceError } from '../Graph.js';
import { Service } from '../key.js';
import { Layer } from '../Layer.js';
import { Scope } from '../Scope.js';
import { Visitor } from '../testing.js';
import { test as mountApp } from './test.svelte.js';
import { Room } from './test-utils/screen-tier-fixtures.svelte.js';

class Gate extends Service<Gate>()('Nested.Gate', { tier: 'app' }) {
  outer = $state(true);
  inner = $state(true);
}

const trace: string[] = [];

class Outer extends Service<Outer>()('Nested.Outer', { tier: 'app', eager: true }) {
  static *make() {
    trace.push('outer:start');
    (yield* Scope).defer(() => void trace.push('outer:stop'));
    return new Outer();
  }
}

class Inner extends Service<Inner>()('Nested.Inner', { tier: 'app', eager: true }) {
  static *make() {
    trace.push('inner:start');
    (yield* Scope).defer(() => void trace.push('inner:stop'));
    return new Inner();
  }
}

class Resident extends Service<Resident>()('Nested.Resident', { tier: 'visitor', eager: true }) {
  static *make() {
    trace.push(`resident:${(yield* Scope).home.name}`);
    return new Resident();
  }
}

function set(gate: Gate, change: Partial<Pick<Gate, 'outer' | 'inner'>>): void {
  Object.assign(gate, change);
  flushSync();
}

describe('a condition nested in a conditional layer', () => {
  it('is read only while the outer condition holds, and leaves with it', async () => {
    trace.length = 0;
    const gate = new Gate();
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          Gate,
          (g) => g.outer,
          Layer.mergeAll(
            Outer,
            Layer.when(Gate, (g) => g.inner, Inner),
          ),
        ),
      ),
      Layer.of(Gate, gate),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );
    await flush();
    expect(trace).toEqual(['outer:start', 'inner:start']);

    set(gate, { outer: false });
    await flush();
    expect(trace).toEqual(['outer:start', 'inner:start', 'inner:stop', 'outer:stop']);
    expect(() => rt.get(Inner)).toThrow(UnknownServiceError);

    set(gate, { inner: false });
    set(gate, { inner: true });
    await flush();
    expect(trace).toHaveLength(4);
    expect(() => rt.get(Inner)).toThrow(UnknownServiceError);

    set(gate, { outer: true });
    await flush();
    expect(trace.slice(4)).toEqual(['outer:start', 'inner:start']);
    await rt.unmount();
  });

  it('brought by a signed-in chunk, never reaches the guest scope that follows', async () => {
    trace.length = 0;
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(Visitor.present('user'), () => Promise.resolve({ default: Layer.mergeAll(Layer.when(() => true, Resident)) })),
      ),
      Layer.mergeAll(),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );
    await flush();
    expect(trace).toEqual([]);

    rt.place('visitor', Visitor.user('1'));
    flushSync();
    await flush();
    expect(trace).toEqual(['resident:visitor:user:1']);

    rt.place('visitor', Visitor.guest());
    flushSync();
    await flush();
    expect(trace).toEqual(['resident:visitor:user:1']);
    expect(() => rt.get(Resident)).toThrow(UnknownServiceError);
    await rt.unmount();
  });

  it('stands under its outer condition’s rung: an app-tier key it admits inside a rung’s layer is refused', () => {
    expect(() =>
      mountApp(Layer.mergeAll(Layer.when(Visitor.present('user'), Layer.mergeAll(Layer.when(() => true, Inner)))), Layer.mergeAll(), {
        ladder: [Visitor],
        at: { visitor: Visitor.user('1') },
        data: 'lazy',
      }),
    ).toThrow(LayerTierError);
  });

  it('in a visitor’s layer is read where the visitor admitted it, not again in a rung under the visitor', async () => {
    trace.length = 0;
    const rt = mountApp(
      Layer.mergeAll(Layer.when(Visitor.present('user'), Layer.mergeAll(Layer.when(() => true, Resident)))),
      Layer.mergeAll(),
      {
        ladder: [Visitor, Room],
        at: { visitor: Visitor.user('1'), room: { id: 'a' } },
      },
    );
    await flush();
    expect(rt.app.scopeOf('room').name).toBe('visitor:user:1/room:a');
    expect(trace).toEqual(['resident:visitor:user:1']);
    await rt.unmount();
  });

  it('shared by two outer layers, stays while either of them holds', async () => {
    trace.length = 0;
    const gate = new Gate();
    const second = new Gate();
    const shared = Layer.when(Gate, (g) => g.inner, Inner);
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(() => gate.outer, shared),
        Layer.when(() => second.outer, shared),
      ),
      Layer.of(Gate, gate),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );
    await flush();
    expect(trace).toEqual(['inner:start']);

    set(gate, { outer: false });
    await flush();
    expect(trace).toEqual(['inner:start']);

    set(second, { outer: false });
    await flush();
    expect(trace).toEqual(['inner:start', 'inner:stop']);
    await rt.unmount();
  });
});

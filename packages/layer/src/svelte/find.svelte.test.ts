import { flush } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Service } from '../key.js';
import { Layer } from '../Layer.js';
import { Visitor } from '../testing.js';
import { test as mountApp } from './test.svelte.js';

class Gate extends Service<Gate>()('Find.Gate', { tier: 'app' }) {
  on = $state(false);
}

class Account extends Service<Account>()('Find.Account', { tier: 'user' }) {
  static make(): Account {
    return new Account();
  }
}

class Feature extends Service<Feature>()('Find.Feature', { tier: 'app' }) {
  static make(): Feature {
    return new Feature();
  }
}

class Clock extends Service<Clock>()('Find.Clock', { tier: 'app' }) {
  static make(): Clock {
    return new Clock();
  }
}

class Reader extends Service<Reader>()('Find.Reader', { tier: 'app' }) {
  static *make() {
    return new Reader(yield* Feature.optional());
  }

  constructor(readonly feature: Feature | undefined) {
    super();
  }
}

describe('optional() in make', () => {
  it('answers a key under a condition with its instance where the condition holds, and with nothing where it does not', async () => {
    const readerUnder = async (on: boolean): Promise<{ read: Feature | undefined; feature: Feature | undefined }> => {
      const gate = new Gate();
      gate.on = on;
      const rt = mountApp(
        Layer.mergeAll(
          Reader,
          Layer.when(Gate, (g) => g.on, Feature),
        ),
        Layer.of(Gate, gate),
        { data: 'lazy' },
      );
      await flush();
      const seen = { read: rt.get(Reader).feature, feature: rt.app.find(Feature) };
      await rt.unmount();
      return seen;
    };

    const held = await readerUnder(true);
    expect(held.read).toBeInstanceOf(Feature);
    expect(held.read).toBe(held.feature);
    expect((await readerUnder(false)).read).toBeUndefined();
  });
});

describe('find()', () => {
  it('answers a kind’s key with nothing while another kind stands, and with the instance once its kind does', async () => {
    const rt = mountApp(Layer.mergeAll(Account), Layer.of(Gate, new Gate()), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      data: 'lazy',
    });
    expect(rt.app.find(Account)).toBeUndefined();

    rt.place('visitor', Visitor.user('1'));
    flushSync();
    await flush();
    expect(rt.app.find(Account)).toBeInstanceOf(Account);
    expect(rt.app.find(Account)).toBe(rt.get(Account));
    await rt.unmount();
  });

  it('answers a key under a condition by what the condition says at the moment of asking', async () => {
    const gate = new Gate();
    const rt = mountApp(
      Layer.mergeAll(
        Clock,
        Layer.when(Gate, (g) => g.on, Feature),
      ),
      Layer.of(Gate, gate),
      {
        ladder: [Visitor],
        at: { visitor: Visitor.guest() },
        data: 'lazy',
      },
    );
    expect(rt.app.find(Feature)).toBeUndefined();
    expect(rt.app.find(Clock)).toBeInstanceOf(Clock);

    gate.on = true;
    flushSync();
    await flush();
    expect(rt.app.find(Feature)).toBeInstanceOf(Feature);

    gate.on = false;
    flushSync();
    await flush();
    expect(rt.app.find(Feature)).toBeUndefined();
    await rt.unmount();
  });

  it('answers a rung’s key with nothing while its source answers nothing', async () => {
    const rt = mountApp(Layer.mergeAll(Account), Layer.mergeAll(), { ladder: [Visitor], at: { visitor: undefined }, data: 'lazy' });
    expect(rt.app.find(Account)).toBeUndefined();
    await rt.unmount();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Condition, type Fact } from '../condition.js';
import { Service } from '../key.js';
import { Layer } from '../Layer.js';
import { Visitor } from '../testing.js';
import { test as mountApp } from './test.svelte.js';

const LATCH_MS = 220;

class Profile extends Service<Profile>()('Profile', { tier: 'app' }) {
  static make(): Profile {
    return new Profile();
  }

  isOpen = $state(false);
  readonly open = Condition.of(() => this.isOpen);

  get alsoOpen(): Fact {
    return this.open;
  }
}

class GameHeader extends Service<GameHeader>()('GameHeader', { tier: 'app' }) {
  static make(): GameHeader {
    return new GameHeader();
  }

  selectOpen = $state(false);
  readonly currencySelectSettled = Condition.latch(() => this.selectOpen, LATCH_MS);
}

function mount() {
  return mountApp(Layer.mergeAll(Profile, GameHeader), Layer.mergeAll(), { ladder: [Visitor], at: { visitor: Visitor.guest() } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Condition: a fact a service hands out', () => {
  it('answers the source it was built over, live', async () => {
    const app = mount();
    const profile = app.get(Profile);

    expect(profile.open.current).toBe(false);
    profile.isOpen = true;
    expect(profile.open.current).toBe(true);

    await app.unmount();
  });

  it('signs itself with the owner and the field it sits on', async () => {
    const app = mount();

    expect(app.get(Profile).open.name).toBe('Profile.open');
    expect(app.get(GameHeader).currencySelectSettled.name).toBe('GameHeader.currencySelectSettled');

    await app.unmount();
  });

  it('leaves a fact behind a getter unnamed rather than evaluating it', async () => {
    const app = mount();
    const profile = app.get(Profile);

    expect(profile.alsoOpen).toBe(profile.open);
    expect(profile.alsoOpen.name).toBe('Profile.open');

    await app.unmount();
  });

  it('holds a fallen source up for its latch, and publishes when it stops', async () => {
    vi.useFakeTimers();
    const app = mount();
    const header = app.get(GameHeader);

    header.selectOpen = true;
    expect(header.currencySelectSettled.current).toBe(true);
    expect(header.currencySelectSettled.holdsUntilMs).toBeUndefined();

    header.selectOpen = false;
    const stopsAtMs = Date.now() + LATCH_MS;
    expect(header.currencySelectSettled.current).toBe(true);
    expect(header.currencySelectSettled.holdsUntilMs).toBe(stopsAtMs);

    vi.setSystemTime(stopsAtMs - 1);
    expect(header.currencySelectSettled.current).toBe(true);

    vi.setSystemTime(stopsAtMs);
    expect(header.currencySelectSettled.current).toBe(false);

    await app.unmount();
  });

  it('combines two facts, and takes the earlier moment either of them can change on its own', async () => {
    vi.useFakeTimers();
    const app = mount();
    const profile = app.get(Profile);
    const header = app.get(GameHeader);
    const both = profile.open.and(header.currencySelectSettled);

    profile.isOpen = true;
    expect(both.current).toBe(false);

    header.selectOpen = true;
    expect(both.current).toBe(true);
    expect(both.holdsUntilMs).toBeUndefined();

    header.selectOpen = false;
    expect(both.holdsUntilMs).toBe(Date.now() + LATCH_MS);

    await app.unmount();
  });
});

import { flush } from '@runlith/testing/flush';
import { reactiveValue } from '@runlith/testing/reactive';
import { mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import { gatedSearch, pending, settleAll } from './test-utils/handoff-fixtures.svelte.js';
import HandoffProbe from './test-utils/HandoffProbe.svelte';

describe('an answer that lands after the session changed', () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it('reaches the view through the incoming session', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const authed = reactiveValue(false);
    const app = mount(HandoffProbe, {
      target,
      props: {
        get authed() {
          return authed.value;
        },
      },
    });

    await flush();
    expect(target.querySelector('[data-testid="blocker"]')?.textContent).toBe('ready');

    authed.value = true;
    await flush();
    expect(target.querySelector('[data-testid="blocker"]')?.textContent).toBe('loading');

    await Promise.resolve().then(() => settleAll('answer'));
    await flush();

    expect(target.querySelector('[data-testid="blocker"]')?.textContent).toBe('ready');

    await unmount(app);
    target.remove();
  });

  it('reaches the view while the incoming frame still awaits its chunk', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const authed = reactiveValue(false);
    const search = gatedSearch();
    const app = mount(HandoffProbe, {
      target,
      props: {
        get authed() {
          return authed.value;
        },
        search: search.layer,
        awaits: true,
      },
    });

    await flush();
    expect(target.querySelector('[data-testid="blocker"]')?.textContent).toBe('ready');

    authed.value = true;
    await flush();
    await Promise.resolve().then(() => settleAll('answer'));
    await flush();

    search.release();
    await flush();
    expect(target.querySelector('[data-testid="blocker"]')?.textContent).toBe('ready');

    await unmount(app);
    target.remove();
  });
});

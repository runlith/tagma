import { flush } from '@runlith/testing/flush';
import { reactiveValue } from '@runlith/testing/reactive';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Visitor, type VisitorInput } from '../testing.js';
import { log } from './test-utils/fixtures.js';
import RecycleProbe from './test-utils/RecycleProbe.svelte';

describe('session recycle in markup', () => {
  it('serves the incoming branch from the new session and closes the old one after the outgoing branch', async () => {
    log.length = 0;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const session = reactiveValue<VisitorInput>(Visitor.guest());
    const props = {
      get session() {
        return session.value;
      },
    };

    const app = mount(RecycleProbe, { target, props });
    await flush();
    expect(log).toEqual(['guest-consumer:open']);

    session.value = Visitor.user('7');
    await flush();
    expect(log).toEqual(['guest-consumer:open', 'user-consumer:7:open', 'guest-consumer-destroyed', 'teaser-closed']);
    expect(target.querySelector('[data-testid="user"]')?.textContent).toBe('7');

    session.value = Visitor.user('8');
    await flush();
    expect(log.slice(4)).toEqual(['user-consumer:8:open', 'user-consumer-destroyed:7', 'profile-closed:7']);

    await unmount(app);
    await flush();
    expect(log.at(-1)).toBe('profile-closed:8');
    target.remove();
  });
});

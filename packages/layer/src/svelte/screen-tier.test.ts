import { flush } from '@runlith/testing/flush';
import { mount, onDestroy, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { TierMismatchError } from '../Graph.js';
import { Visitor } from '../testing.js';
import { App } from './App.svelte.js';
import {
  at,
  definition,
  Doorman,
  ExitScreen,
  GreedyScreen,
  GuestScreen,
  Ledger,
  LedgerScreen,
  LobbyScreen,
  page,
  RoomScreen,
  VisitorScreen,
} from './test-utils/screen-tier-fixtures.svelte.js';
import TieredScreenHost from './test-utils/TieredScreenHost.svelte';

function host(run: () => void, page?: () => void) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const app = mount(TieredScreenHost, { target, props: { definition, run, page } });
  return {
    unmount: async () => {
      await unmount(app);
      target.remove();
    },
  };
}

describe('a screen that names no tier', () => {
  it('stands at the deepest tier open wherever anything is, and takes the keys that rung keeps of its own', async () => {
    let screen: LobbyScreen | undefined;
    const app = host(() => {
      screen = LobbyScreen.mount();
    });
    await flush();

    expect(screen?.scope.parent?.name).toBe('hall:main');
    expect(screen?.doorman).toBeInstanceOf(Doorman);
    await app.unmount();
  });
});

describe('a screen stands under the scope of its own tier', () => {
  it('keeps its section when the rung below its tier closes', async () => {
    at.visitor = Visitor.user('7');
    at.room = { id: 'a' };
    let screen: VisitorScreen | undefined;
    const app = host(() => {
      screen = VisitorScreen.mount();
    });
    await flush();

    expect(screen?.scope.parent?.name).toBe('visitor:user:7');

    at.room = undefined;
    await flush();
    expect(screen?.scope.closed).toBe(false);

    await app.unmount();
    await flush();
    expect(screen?.scope.closed).toBe(true);
  });

  it('refuses at mount when no scope of its tier is open, naming the screen and the tier', async () => {
    at.visitor = Visitor.user('7');
    at.room = undefined;
    let error: unknown;
    const app = host(() => {
      try {
        RoomScreen.mount();
      } catch (caught) {
        error = caught;
      }
    });

    expect(String(error)).toContain('RoomScreen');
    expect(String(error)).toContain('room');
    await app.unmount();
  });

  it('refuses a key of a tier deeper than its own, even while that rung is open', async () => {
    at.visitor = Visitor.user('7');
    at.room = { id: 'a' };
    let error: unknown;
    const app = host(() => {
      try {
        GreedyScreen.mount();
      } catch (caught) {
        error = caught;
      }
    });

    expect(error).toBeInstanceOf(TierMismatchError);
    await app.unmount();
  });

  it('ends its section with the page: what the section owns is aborted at once, and the leaving component still reads the instance', async () => {
    at.visitor = Visitor.user('7');
    at.room = { id: 'a' };
    page.open = true;
    let screen: ExitScreen | undefined;
    let arrive: (() => void) | undefined;
    const exit: string[] = [];
    const app = host(
      () => undefined,
      () => {
        screen = ExitScreen.mount();
        screen.commit(
          new Promise<void>((resolve) => {
            arrive = resolve;
          }),
        );
        onDestroy(() => exit.push(`closed=${screen?.scope.closed ?? false} read=${screen?.bump() ?? 0}`));
      },
    );
    await flush();
    expect(screen?.scope.closed).toBe(false);

    page.open = false;
    await flush();
    arrive?.();
    await flush();

    expect(exit).toEqual(['closed=true read=1']);
    expect(screen?.landed).toEqual([]);
    await app.unmount();
  });

  it('refuses a screen of a kind the standing scope is not, naming what stands', async () => {
    at.visitor = Visitor.user('7');
    at.room = { id: 'a' };
    let error: unknown;
    let scope: unknown;
    const app = host(() => {
      try {
        scope = GuestScreen.mount().scope;
      } catch (caught) {
        error = caught;
      }
    });

    expect(scope).toBeUndefined();
    expect(String(error)).toContain('GuestScreen');
    expect(String(error)).toContain('guest');
    expect(String(error)).toContain('user');
    await app.unmount();
  });

  it('is built with what its subtree answers for a key, not with what the manifest alone says', async () => {
    at.visitor = Visitor.user('7');
    at.room = { id: 'a' };
    let screen: LedgerScreen | undefined;
    const app = host(() => {
      App.override(Ledger, new Ledger('subtree'));
      screen = LedgerScreen.mount();
    });

    expect(screen?.ledger.name).toBe('subtree');
    await app.unmount();
  });
});

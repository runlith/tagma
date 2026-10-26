import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { UnknownServiceError } from '../Graph.js';
import { Layer, type LayerLike } from '../Layer.js';
import {
  Config,
  counter,
  disposed,
  FailingScreen,
  MakelessScreen,
  PanelScreen,
  ScopedScreen,
  TickerScreen,
} from './test-utils/screen-fixtures.svelte.js';
import Probe from './test-utils/Probe.svelte';
import ScreenTestHost from './test-utils/ScreenTestHost.svelte';

function host(props: { boot?: LayerLike; run: () => void; probe?: () => void }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const app = mount(ScreenTestHost, {
    target,
    props: { boot: props.boot ?? Layer.of(Config, new Config('acme')), run: props.run, probe: props.probe },
  });
  return {
    unmount: async () => {
      await unmount(app);
      target.remove();
    },
  };
}

describe('Screen', () => {
  it('mount builds through make: services come from the app, options from the section', async () => {
    const config = new Config('acme');
    let screen: PanelScreen | undefined;

    const app = host({
      boot: Layer.of(Config, config),
      run: () => {
        screen = PanelScreen.mount({ slot: 'lobby' });
      },
    });

    expect(screen?.config).toBe(config);
    expect(screen?.slot).toBe('lobby');
    await app.unmount();
  });

  it('use() in a descendant answers with the mounted instance', async () => {
    let mounted: PanelScreen | undefined;
    let read: PanelScreen | undefined;

    const app = host({
      run: () => {
        mounted = PanelScreen.mount({ slot: 'lobby' });
      },
      probe: () => {
        read = PanelScreen.use();
      },
    });

    expect(read).toBe(mounted);
    await app.unmount();
  });

  it('use() without a mounted screen refuses by name', async () => {
    let error: unknown;

    const app = host({
      run: () => undefined,
      probe: () => {
        try {
          PanelScreen.use();
        } catch (caught) {
          error = caught;
        }
      },
    });

    expect(String(error)).toContain('Screen "PanelScreen" is not mounted');
    await app.unmount();
  });

  it('mount outside an app refuses', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    expect(() =>
      mount(Probe, {
        target,
        props: {
          run: () => {
            PanelScreen.mount({ slot: 'lobby' });
          },
        },
      }),
    ).toThrow(/App is not mounted/);
    target.remove();
  });

  it('a screen with no make() refuses by name', async () => {
    let error: unknown;
    const app = host({
      run: () => {
        try {
          MakelessScreen.mount();
        } catch (caught) {
          error = caught;
        }
      },
    });

    expect(String(error)).toContain('Screen "MakelessScreen" declares no static make()');
    await app.unmount();
  });

  it('a make that asks for a service outside the manifest gets the graph refusal', async () => {
    let error: unknown;
    const app = host({
      boot: Layer.mergeAll() as never,
      run: () => {
        try {
          PanelScreen.mount({ slot: 'lobby' });
        } catch (caught) {
          error = caught;
        }
      },
    });

    expect(error).toBeInstanceOf(UnknownServiceError);
    await app.unmount();
  });

  it('a make that asks for Scope gets one that closes with the component', async () => {
    let screen: ScopedScreen | undefined;
    const app = host({
      run: () => {
        screen = ScopedScreen.mount();
      },
    });

    await flush();

    expect(screen?.scope.closed).toBe(false);
    expect(screen?.scope.tier).toBeUndefined();
    await app.unmount();
    expect(screen?.scope.closed).toBe(true);
  });

  it('a make that fails closes what it deferred at once, not with the component', async () => {
    disposed.length = 0;
    let error: unknown;
    const app = host({
      run: () => {
        try {
          FailingScreen.mount();
        } catch (caught) {
          error = caught;
        }
      },
    });

    expect(String(error)).toContain('screen make failed');
    expect(disposed).toEqual(['disposed']);
    await app.unmount();
    expect(disposed).toEqual(['disposed']);
  });

  it('a screen lives with its component: effects run while mounted and stop after unmount', async () => {
    let screen: TickerScreen | undefined;
    const app = host({
      run: () => {
        screen = TickerScreen.mount();
      },
    });
    await flush();

    counter.value += 1;
    await flush();
    const observed = screen?.seen.length ?? 0;
    expect(observed).toBeGreaterThanOrEqual(2);

    await app.unmount();
    counter.value += 1;
    await flush();
    expect(screen?.seen.length).toBe(observed);
  });

  it('two sections mount two independent instances', async () => {
    let first: PanelScreen | undefined;
    let second: PanelScreen | undefined;

    const one = host({
      run: () => {
        first = PanelScreen.mount({ slot: 'lobby' });
      },
    });
    const two = host({
      run: () => {
        second = PanelScreen.mount({ slot: 'vip' });
      },
    });

    expect(first).not.toBe(second);
    expect(first?.slot).toBe('lobby');
    expect(second?.slot).toBe('vip');
    await one.unmount();
    await two.unmount();
  });
});

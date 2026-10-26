import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import { MountedApp, App as Core } from '../App.js';
import { UnknownEntryError, UnknownServiceError } from '../Graph.js';
import { Layer } from '../Layer.js';
import { Platform, serverPlatform } from '../Platform.js';
import { Prepare } from '../Prepare.js';
import { Router } from '../Router.js';
import { ScopeAbort } from '../Scope.js';
import { Visitor, type VisitorInput } from '../testing.js';
import AppHost from './AppHost.svelte';
import { App, worldHooks } from './App.svelte.js';
import { Corner, routerAt, section, trace } from './test-utils/entry-fixtures.svelte.js';
import { test as mountApp } from './test.svelte.js';

beforeEach(() => {
  trace.length = 0;
});

function open(entry: ReturnType<typeof section>['entry'], visitor: VisitorInput) {
  const at = $state({ routeId: '/', status: 200 });
  const rt = mountApp(Layer.mergeAll(entry), Layer.of(Router, routerAt(at)), {
    ladder: [Visitor],
    at: { visitor },
    data: 'lazy',
  });
  return { rt, at };
}

describe('an entry a route opens', () => {
  it('is registered by the load and starts only when the visitor stands on its route', async () => {
    const { entry, calls } = section();
    const { rt, at } = open(entry, Visitor.guest());
    await flush();

    await rt.app.enter(entry, '/section');
    flushSync();
    expect(calls.entry).toBe(1);
    expect(trace).toEqual([]);

    at.routeId = '/section';
    flushSync();
    expect(trace).toEqual(['balance:guest']);
    expect(rt.get(Corner)).toBeInstanceOf(Corner);
    await rt.unmount();
  });

  it('does not start on a page that answered an error, and starts on the route answered whole', async () => {
    const { entry } = section();
    const { rt, at } = open(entry, Visitor.guest());
    await rt.app.enter(entry, '/section');

    at.routeId = '/section';
    at.status = 404;
    flushSync();
    expect(trace).toEqual([]);

    at.status = 200;
    flushSync();
    expect(trace).toEqual(['balance:guest']);
    await rt.unmount();
  });

  it('on the first document starts as the app mounts on its route', async () => {
    const { entry } = section();
    const at = { routeId: '/section', status: 200 };
    const app = new MountedApp(
      Core.define(Layer.mergeAll(entry, Layer.of(Router, routerAt(at)), Visitor.of(Visitor.guest)), {
        ladder: [Visitor],
        data: 'lazy',
      }),
      Layer.of(Platform, serverPlatform()),
      worldHooks,
    );
    await app.enter(entry, '/section');
    expect(trace).toEqual([]);

    const target = document.createElement('div');
    document.body.appendChild(target);
    const host = mount(AppHost, { target, props: { create: () => App.attach(app), onReady: () => undefined } });
    flushSync();
    expect(trace).toEqual(['balance:guest']);
    await unmount(host);
    await app.close();
    target.remove();
  });
});

describe('an entry at work across visitors', () => {
  it('meets an open player whole: the signed-in chunk arrives with the code, so both presenters start in one tick', async () => {
    const { entry, calls } = section();
    const { rt, at } = open(entry, Visitor.user('1'));
    await flush();

    await rt.app.enter(entry, '/section');
    expect(calls.user).toBe(1);
    at.routeId = '/section';
    flushSync();
    expect(trace).toEqual(['balance:user:1', 'reminder:1']);
    await rt.unmount();
  });

  it('entered as a guest, is whole in the visitor a sign-in prepares, and in the next account', async () => {
    const { entry, calls } = section();
    const { rt, at } = open(entry, Visitor.guest());
    await rt.app.enter(entry, '/section');
    at.routeId = '/section';
    flushSync();
    expect(calls.user).toBe(0);

    await rt.get(Prepare)(Visitor, Visitor.user('1'));
    expect(calls.user).toBe(1);
    rt.place('visitor', Visitor.user('1'));
    flushSync();
    expect(trace).toEqual(expect.arrayContaining(['balance:user:1', 'reminder:1']));

    trace.length = 0;
    rt.place('visitor', Visitor.user('2'));
    flushSync();
    await flush();
    expect(trace).toEqual(expect.arrayContaining(['balance:user:2', 'reminder:2', 'balance-end:user:1']));
    await rt.unmount();
  });
});

describe('an entry that cannot arrive', () => {
  it('refuses the load while its chunk fails, fetches again on the next load, and serves two loads with one flight', async () => {
    let fail = true;
    const { entry, calls } = section({
      entry: async () => {
        if (fail) throw new Error('offline');
      },
    });
    const { rt } = open(entry, Visitor.guest());

    await expect(rt.app.enter(entry, '/section')).rejects.toThrow('offline');
    expect(() => rt.get(Corner)).toThrow(UnknownServiceError);

    fail = false;
    await Promise.all([rt.app.enter(entry, '/section'), rt.app.enter(entry, '/section')]);
    expect(calls.entry).toBe(2);
    expect(rt.get(Corner)).toBeInstanceOf(Corner);
    await rt.unmount();
  });

  it('refuses the load while its signed-in chunk fails, registers nothing, and fetches it again next time', async () => {
    let fail = true;
    const { entry, calls } = section({
      user: async () => {
        if (fail) throw new Error('offline');
      },
    });
    const { rt } = open(entry, Visitor.user('1'));
    await flush();

    await expect(rt.app.enter(entry, '/section')).rejects.toThrow('offline');
    expect(() => rt.get(Corner)).toThrow(UnknownServiceError);

    fail = false;
    await rt.app.enter(entry, '/section');
    expect(calls.user).toBe(2);
    await rt.unmount();
  });

  it('is aborted by the app closing while its chunk flies', async () => {
    let resume: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const { entry } = section({ entry: () => held });
    const { rt } = open(entry, Visitor.guest());

    const entering = rt.app.enter(entry, '/section');
    const aborted = expect(entering).rejects.toBeInstanceOf(ScopeAbort);
    await rt.unmount();
    resume();
    await aborted;
  });

  it('is refused when the manifest does not list it, and a key nobody registered names the entries not passed', async () => {
    const listed = section();
    const unlisted = section();
    const { rt } = open(listed.entry, Visitor.guest());

    await expect(rt.app.enter(unlisted.entry, '/other')).rejects.toBeInstanceOf(UnknownEntryError);
    let refusal: unknown;
    try {
      rt.get(Corner);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(UnknownServiceError);
    expect(refusal).toMatchObject({ unentered: ['section'] });
    await rt.unmount();
  });
});

describe('an entry on the server', () => {
  it('starts at once in the request that opened it, and a second request stays without it', async () => {
    const { entry } = section();
    const definition = Core.define(Layer.mergeAll(entry, Visitor.of(Visitor.guest)), { ladder: [Visitor] });
    const request = () =>
      new MountedApp(definition, Layer.of(Platform, serverPlatform()), {
        effectRoot: (build) => {
          build();
          return () => undefined;
        },
        start: 'open',
        data: 'lazy',
      });
    const one = request();
    const two = request();
    one.ensure(Visitor);
    two.ensure(Visitor);

    await one.enter(entry, '/section');
    expect(trace).toEqual(['balance:guest']);
    expect(one.resolve(Corner)).toBeInstanceOf(Corner);
    expect(() => two.resolve(Corner)).toThrow(UnknownServiceError);
    await Promise.all([one.close(), two.close()]);
  });
});

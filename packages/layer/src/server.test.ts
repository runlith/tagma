import { describe, expect, it, test } from 'vitest';

import { Graph } from './Graph.js';
import { Service } from './key.js';
import { Layer } from './Layer.js';
import { MountedApp, App } from './App.js';
import { Scope } from './Scope.js';
import { Visitor, type VisitorInput } from './testing.js';
import { Platform, serverPlatform } from './Platform.js';
import { currentRequestApp, currentApp, withRequestApp } from './request/node.js';

const ServerLive = Layer.of(Platform, serverPlatform());

function inlineRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

class Boot extends Service<Boot>()('Boot', { tier: 'app' }) {
  static *make() {
    return new Boot((yield* Platform).storage.local.getItem('anything'));
  }
  constructor(readonly stored: string | null) {
    super();
  }
}

class Account extends Service<Account>()('Account', { tier: 'user' }) {
  static *make() {
    return new Account(yield* Visitor.Current, yield* Boot);
  }
  constructor(
    readonly session: VisitorInput,
    readonly boot: Boot,
  ) {
    super();
  }
}

describe('the server world', () => {
  it('builds both tiers with no effect root and no DOM', async () => {
    const graph = new Graph(Layer.mergeAll(Boot, Account, ServerLive), { effectRoot: inlineRoot, ladder: [Visitor] });
    const app = Scope.make();
    await graph.open(app);

    const { scope, ready } = graph.openRung(app, Visitor, Visitor.user('42'));
    await ready;

    expect(graph.resolve(Boot, app).stored).toBeNull();
    expect(graph.resolve(Account, scope).session.id).toBe('42');
    await app.close();
  });

  it('server storage answers without throwing, so a service may read it on either side', () => {
    const graph = new Graph(Layer.mergeAll(ServerLive), { effectRoot: inlineRoot });
    const app = Scope.make();
    void graph.open(app);

    const platform = graph.resolve(Platform, app);
    platform.storage.session.setItem('k', 'v');
    expect(platform.storage.session.getItem('k')).toBeNull();
  });
});

const definition = App.define(
  Layer.mergeAll(
    Boot,
    Account,
    Visitor.of(() => Visitor.user('42')),
  ),
  { ladder: [Visitor] },
);

function open(): MountedApp {
  return new MountedApp(definition, ServerLive, { effectRoot: inlineRoot, start: 'open' });
}

test('a world key the manifest provides itself is filled by the manifest, not by the world', () => {
  const own = serverPlatform({ languages: ['own'] });
  const app = new MountedApp(App.define(Layer.mergeAll(Layer.of(Platform, own))), ServerLive, { effectRoot: inlineRoot, start: 'open' });
  expect(app.resolve(Platform)).toBe(own);
});

describe('the request app', () => {
  it('is visible to everything inside the request and to nothing outside it', async () => {
    expect(currentRequestApp()).toBeUndefined();

    const seen = await withRequestApp('r1', open(), async (request) => {
      const nested = await Promise.resolve().then(() => currentApp(definition));
      expect(nested).toBe(request.app);
      expect(request.app.resolve(Account).session.id).toBe('42');
      return request;
    });

    expect(seen.app.app.closed).toBe(true);
    expect(currentRequestApp()).toBeUndefined();
  });

  it('closes its app even when the request fails', async () => {
    let captured: MountedApp | undefined;

    await expect(
      withRequestApp('r2', open(), async (request) => {
        captured = request.app;
        throw new Error('render failed');
      }),
    ).rejects.toThrow('render failed');

    expect(captured?.app.closed).toBe(true);
  });

  it('two requests in flight never see each other', async () => {
    const ids: string[] = [];
    const request = (id: string, delay: number) =>
      withRequestApp(id, open(), async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        ids.push(currentRequestApp()?.id ?? 'none');
      });

    await Promise.all([request('slow', 20), request('fast', 1)]);

    expect(ids).toEqual(['fast', 'slow']);
  });
});

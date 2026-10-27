import { expect, test, vi } from 'vitest';
import { UNAVAILABLE, ViewBridge, type ViewHost, type ViewParams } from './ViewBridge.js';

const ORIGIN = 'http://127.0.0.1:5636';

type Rig = {
  readonly bridge: ViewBridge;
  readonly posted: unknown[];
  readonly calls: { readonly server: string; readonly params: ViewParams }[];
  readonly released: string[];
  readonly aborted: string[];
  readonly acquiring: PromiseWithResolvers<void>;
  readonly acquire: PromiseWithResolvers<void>;
  readonly releasedOne: PromiseWithResolvers<void>;
  answer(id: string | number): Promise<unknown>;
  send(data: unknown, from?: { source?: object; origin?: string }): void;
};

const rig = (): Rig => {
  const proxy = {};
  const posted: unknown[] = [];
  const answers = new Map<string | number, PromiseWithResolvers<unknown>>();
  const post = (message: unknown): void => {
    posted.push(message);
    const reply = message as { readonly id?: string | number };
    if (reply.id !== undefined) answers.get(reply.id)?.resolve(message);
  };
  const calls: { server: string; params: ViewParams }[] = [];
  const released: string[] = [];
  const aborted: string[] = [];
  const acquiring = Promise.withResolvers<void>();
  const acquire = Promise.withResolvers<void>();
  const releasedOne = Promise.withResolvers<void>();
  const bound = 'own-server';
  const host: ViewHost = {
    methods: {
      'tools/call': async (params) => {
        calls.push({ server: bound, params });
        return { content: [{ type: 'text', text: 'done' }] };
      },
      'tools/slow': (params, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => {
            aborted.push(String(params.name));
            reject(signal.reason);
          }),
        ),
    },
    subscribe: async (uri) => {
      if (uri === 'app://refused') throw new Error('mcp-resource-failed');
      if (uri === 'app://slow') {
        acquiring.resolve();
        await acquire.promise;
      }
      return () => {
        released.push(uri);
        releasedOne.resolve();
      };
    },
    context: () => ({}),
  };
  const bridge = new ViewBridge({ origin: ORIGIN, source: () => proxy, post }, host, {
    html: '<p>view</p>',
    csp: {},
    permissions: {},
  });
  return {
    bridge,
    posted,
    calls,
    released,
    aborted,
    acquiring,
    acquire,
    releasedOne,
    answer: (id) => {
      const sent = posted.find((message) => (message as { readonly id?: string | number }).id === id);
      if (sent !== undefined) return Promise.resolve(sent);
      const pending = answers.get(id) ?? Promise.withResolvers<unknown>();
      answers.set(id, pending);
      return pending.promise;
    },
    send: (data, from = {}) => bridge.receive({ source: from.source ?? proxy, origin: from.origin ?? ORIGIN, data }),
  };
};

test('a message that does not come from the mount’s own proxy reaches nothing', async () => {
  const mount = rig();
  mount.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'foreign-source' } }, { source: {} });
  mount.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'foreign-origin' } }, { origin: 'http://127.0.0.1:5633' });
  mount.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'own-proxy' } });
  const answer = await mount.answer(3);
  expect(mount.calls).toEqual([{ server: 'own-server', params: { name: 'own-proxy' } }]);
  expect(mount.posted).toEqual([answer]);
});

test('a capability the mount does not hold answers unavailable', async () => {
  const mount = rig();
  mount.send({ jsonrpc: '2.0', id: 'store', method: 'tagma/storage', params: {} });
  await mount.answer('store');
  expect(mount.posted).toEqual([
    { jsonrpc: '2.0', id: 'store', error: { code: UNAVAILABLE, message: 'unavailable', data: { method: 'tagma/storage' } } },
  ]);
});

test('a subscription the server refuses is answered as a failure, never as success', async () => {
  const mount = rig();
  mount.send({ jsonrpc: '2.0', id: 5, method: 'resources/subscribe', params: { uri: 'app://refused' } });
  await mount.answer(5);
  expect(mount.posted).toEqual([{ jsonrpc: '2.0', id: 5, error: { code: -32000, message: 'mcp-resource-failed' } }]);
});

test('a subscription the view lets go of while it is being acquired is released once it lands', async () => {
  const mount = rig();
  mount.send({ jsonrpc: '2.0', id: 1, method: 'resources/subscribe', params: { uri: 'app://slow' } });
  await mount.acquiring.promise;
  mount.send({ jsonrpc: '2.0', id: 2, method: 'resources/unsubscribe', params: { uri: 'app://slow' } });
  mount.acquire.resolve();
  await mount.releasedOne.promise;
  expect(mount.released).toEqual(['app://slow']);
});

test('the host speaks to the view only after it initialized, and its subscriptions and requests end once the view answers teardown', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const mount = rig();
  try {
    expect(mount.bridge.notify('ui/notifications/tool-input', { arguments: {} })).toBe(false);
    mount.send({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(mount.bridge.notify('ui/notifications/tool-input', { arguments: {} })).toBe(true);
    mount.send({ jsonrpc: '2.0', id: 3, method: 'resources/subscribe', params: { uri: 'ui://a' } });
    mount.send({ jsonrpc: '2.0', id: 4, method: 'resources/subscribe', params: { uri: 'app://b' } });
    mount.send({ jsonrpc: '2.0', id: 8, method: 'tools/slow', params: { name: 'first' } });
    mount.send({ jsonrpc: '2.0', id: 8, method: 'tools/slow', params: { name: 'second' } });
    await Promise.all([mount.answer(3), mount.answer(4), mount.answer(8)]);
    const closed = mount.bridge.close('unmounted', 1_000);
    const teardown = mount.posted.at(-1) as { readonly id: string };
    expect(teardown).toEqual({ jsonrpc: '2.0', id: teardown.id, method: 'ui/resource-teardown', params: { reason: 'unmounted' } });
    mount.send({ jsonrpc: '2.0', id: 'during-close', method: 'ping' });
    await mount.answer('during-close');
    expect(mount.released).toEqual([]);
    mount.send({ jsonrpc: '2.0', id: teardown.id, result: {} });
    expect(mount.released.sort()).toEqual(['app://b', 'ui://a']);
    expect(mount.aborted).toEqual(['first']);
    await closed;
  } finally {
    mount.bridge.dispose();
    vi.useRealTimers();
  }
});

test('a view keeps its host while it answers teardown, so what it saves on the way out is answered', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const mount = rig();
  try {
    mount.send({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    const closed = mount.bridge.close('unmounted', 1_000);
    const teardown = mount.posted.at(-1) as { readonly id: string };
    mount.send({ jsonrpc: '2.0', id: 'save', method: 'tools/call', params: { name: 'save' } });
    expect(await mount.answer('save')).toEqual({ jsonrpc: '2.0', id: 'save', result: { content: [{ type: 'text', text: 'done' }] } });
    mount.send({ jsonrpc: '2.0', id: teardown.id, result: {} });
    expect(mount.bridge.initialized).toBe(false);
    await closed;
  } finally {
    mount.bridge.dispose();
    vi.useRealTimers();
  }
});

test('a view holds a bounded number of requests in flight, and the one past the bound is refused without reaching the host', async () => {
  const mount = rig();
  for (let id = 0; id <= 64; id += 1) mount.send({ jsonrpc: '2.0', id, method: 'tools/slow', params: { name: String(id) } });
  await mount.answer(64);
  expect(mount.posted).toEqual([{ jsonrpc: '2.0', id: 64, error: { code: -32000, message: expect.any(String) } }]);
  mount.bridge.dispose();
  expect(mount.aborted).toHaveLength(64);
});

test('a view that never answers teardown is let go at the deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const mount = rig();
  try {
    mount.send({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    mount.send({ jsonrpc: '2.0', id: 3, method: 'resources/subscribe', params: { uri: 'ui://a' } });
    await mount.answer(3);
    const closed = mount.bridge.close('unmounted', 1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(mount.released).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await closed;
    expect(mount.released).toEqual(['ui://a']);
  } finally {
    mount.bridge.dispose();
    vi.useRealTimers();
  }
});

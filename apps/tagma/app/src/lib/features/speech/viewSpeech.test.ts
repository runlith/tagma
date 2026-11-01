import type { Heard } from '@tagma/server/speech/contract/wire/listening';
import { SPEECH_NOTIFICATION } from '@tagma/server/speech/contract/wire/view';
import { Effect, Exit, Scope } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';
import { Door } from '$lib/wire/Door.js';
import { LiveConnection } from '$lib/wire/Live.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { SoundChannel } from '$lib/wire/SoundChannel.js';
import { loadCatalog, testCatalog, testOperations } from '$lib/wire/testing.js';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { INVALID_PARAMS, UNAVAILABLE, ViewBridge, type ViewParams, ViewRefusal } from '../views/ViewBridge.js';
import { speechMethod } from './viewSpeech.js';

await loadCatalog();

const utterance: Heard = {
  kind: 'utterance',
  track: 'mic',
  segment: 0,
  seq: 0,
  revision: 1,
  closed: true,
  text: 'Bonjour',
  hypothesis: '',
  from: 0,
  to: 500,
  speaker: null,
};
const admitted: Heard = { kind: 'state', state: 'live' };

type Request = {
  readonly _tag: string;
  readonly id: string;
  readonly tag: string;
  readonly payload: Record<string, unknown>;
  readonly requestId: string;
};

class SpeechSocket extends EventTarget {
  static current: SpeechSocket;
  static frames = 1;
  readyState = 0;
  binaryType = 'arraybuffer';
  readonly active = new Map<string, Request>();
  interrupted = Promise.withResolvers<void>();

  constructor() {
    super();
    SpeechSocket.current = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(encoded: string): void {
    const messages: Request[] = JSON.parse(encoded);
    for (const request of Array.isArray(messages) ? messages : [messages]) {
      if (request._tag === 'Interrupt') {
        this.active.delete(request.requestId);
        this.interrupted.resolve();
      } else if (request._tag === 'Request') {
        this.active.set(request.id, request);
        if (request.tag === 'speech.synthesize') {
          spoken = String(request.payload.text);
          queueMicrotask(() => {
            this.message({
              _tag: 'Chunk',
              requestId: request.id,
              values: [
                { kind: 'voice', provider: 'voice', model: 'small', voice: 'reader', format: { rate: 24000, channels: 1 } },
                ...Array.from({ length: SpeechSocket.frames }, () => ({
                  kind: 'audio',
                  pcm:
                    SpeechSocket.frames === 1
                      ? btoa(String.fromCharCode(0, 128, 0, 0, 255, 127))
                      : btoa(String.fromCharCode(0, 32).repeat(2400)),
                })),
              ],
            });
            this.message({ _tag: 'Exit', requestId: request.id, exit: { _tag: 'Success', value: null } });
          });
        } else queueMicrotask(() => this.event(request.id, admitted));
      }
    }
  }

  event(id: string, event: Heard): void {
    this.message({ _tag: 'Chunk', requestId: id, values: [event] });
  }

  finish(id: string): void {
    this.event(id, utterance);
    this.end(id);
  }

  end(id: string): void {
    this.message({ _tag: 'Exit', requestId: id, exit: { _tag: 'Success', value: null } });
    this.active.delete(id);
  }

  private message(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}

class BrowserBuffer {
  readonly samples: Float32Array[];
  readonly duration: number;
  constructor(channels: number, frames: number, rate: number) {
    this.samples = Array.from({ length: channels }, () => new Float32Array(frames));
    this.duration = frames / rate;
  }
  getChannelData(channel: number): Float32Array {
    return this.samples[channel]!;
  }
}

class BrowserSource {
  buffer: BrowserBuffer | null = null;
  onended: (() => void) | null = null;
  playing = false;
  stopped = false;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.playing = true;
    if (BrowserAudio.automatic) queueMicrotask(() => this.end());
  }
  stop(): void {
    this.stopped = true;
    this.end();
  }
  end(): void {
    this.playing = false;
    this.onended?.();
  }
}

class BrowserAudio {
  static current: BrowserAudio;
  static automatic = true;
  static initialState = 'running';
  state = BrowserAudio.initialState;
  currentTime = 0;
  destination = {};
  readonly sources: BrowserSource[] = [];
  constructor() {
    BrowserAudio.current = this;
  }
  createBuffer(channels: number, frames: number, rate: number): BrowserBuffer {
    return new BrowserBuffer(channels, frames, rate);
  }
  createBufferSource(): BrowserSource {
    const source = new BrowserSource();
    this.sources.push(source);
    return source;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
}

const status = {
  devices: {
    capabilities: { mic: true, system: false, excludeSelf: false, echoCancel: true, muteOutput: false, permissionPrompt: false },
    availability: { _tag: 'present' },
    inputs: [],
    permissions: null,
    refusal: null,
    said: null,
  },
  detector: { _tag: 'present' },
  models: [],
  local: [],
  dictation: { kind: 'blocked', reason: 'not configured', unblock: [], said: 'No speech recognizer is ready.' },
  mic: 'server',
};
let spoken = '';

beforeEach(() => {
  spoken = '';
  BrowserAudio.automatic = true;
  BrowserAudio.initialState = 'running';
  SpeechSocket.frames = 1;
  vi.stubGlobal('AudioContext', BrowserAudio);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://tagma.test' } }));
  vi.stubGlobal('WebSocket', SpeechSocket);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new globalThis.Request(input, init);
    const name = new URL(request.url).pathname.split('/').at(-1);
    if (name === 'speech_status') return Response.json({ status: 'read', speech: status });
    if (name === 'finish_recognition') {
      const { id } = await request.json();
      const socket = SpeechSocket.current;
      const found = [...socket.active.values()].find((row) => row.payload.id === id);
      if (found === undefined) return Response.json({ code: 'unknown-recognition', reason: 'unknown', unblock: [] }, { status: 409 });
      queueMicrotask(() => socket.finish(found.id));
      return Response.json({ status: 'ending', id });
    }
    throw new Error(`unexpected HTTP operation ${name}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

const rig = Effect.fnUntraced(function* () {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const platform = makePlatform();
  const server = new ServerOrigin('http://tagma.test');
  const live = yield* Scope.provide(LiveConnection.make(platform.socket, server, testCatalog()), scope);
  const door = new Door(platform.fetch, server, makeRouter(), testOperations());
  const method = speechMethod(door, live, new SoundChannel(platform.socket, server), 7);
  const source = {};
  const origin = 'http://proxy.test';
  const messages: ViewParams[] = [];
  const changed = Promise.withResolvers<void>();
  const pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  let asked = 0;
  const bridge = new ViewBridge(
    {
      origin,
      source: () => source,
      post: (message) => {
        const sent = message as ViewParams;
        messages.push(sent);
        if (sent.method === SPEECH_NOTIFICATION) changed.resolve();
        if (typeof sent.id === 'number') {
          const answer = pending.get(sent.id);
          if (sent.error !== undefined) {
            const error = sent.error as { code: number; message: string };
            answer?.reject(new ViewRefusal(error.code, error.message));
          } else answer?.resolve(sent.result);
          pending.delete(sent.id);
        }
      },
    },
    { methods: { 'tagma/speech': method }, capabilities: { 'tagma/speech': {} }, context: () => ({}) },
    { html: '', csp: {}, permissions: {} },
  );
  bridge.receive({ source, origin, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' } });
  const mounted = new AbortController();
  const invoke = (params: ViewParams, mount?: AbortController) => {
    if (mount !== undefined)
      return method(params, {
        mounted: mount.signal,
        signal: new AbortController().signal,
        notify: (name, sent) => {
          bridge.notify(name, sent);
        },
      });
    const id = ++asked;
    const answer = Promise.withResolvers<unknown>();
    pending.set(id, answer);
    bridge.receive({ source, origin, data: { jsonrpc: '2.0', id, method: 'tagma/speech', params } });
    return answer.promise;
  };
  const close = Effect.andThen(
    Effect.sync(() => {
      mounted.abort();
      bridge.dispose();
    }),
    Scope.close(scope, Exit.void),
  );
  yield* Effect.addFinalizer(() => close);
  return { bridge, live, invoke, messages, changed, close };
});

it.live('the view receives recognition events and its unsubscribe releases the live speech feed', () =>
  Effect.gen(function* () {
    const view = yield* rig();
    yield* Effect.promise(async () => {
      const opened = (await view.invoke({ action: 'recognize' })) as { subscription: string };
      await view.changed.promise;
      expect(view.messages).toContainEqual({
        jsonrpc: '2.0',
        method: SPEECH_NOTIFICATION,
        params: { subscription: opened.subscription, event: admitted },
      });
      await view.invoke({ action: 'unsubscribe', subscription: opened.subscription });
      await SpeechSocket.current.interrupted.promise;
      expect(SpeechSocket.current.active.size).toBe(0);
      await expect(view.invoke({ action: 'finish', subscription: opened.subscription })).rejects.toMatchObject({ code: INVALID_PARAMS });
    });
  }),
);

it.live('recognition delivers its confirmed tail before ending and text synthesis answers the view', () =>
  Effect.gen(function* () {
    const view = yield* rig();
    yield* Effect.promise(async () => {
      const opened = (await view.invoke({ action: 'recognize' })) as { subscription: string };
      await view.changed.promise;
      await view.invoke({ action: 'finish', subscription: opened.subscription });
      const events = () => view.messages.filter((message) => message.method === SPEECH_NOTIFICATION);
      await waitFor(() =>
        expect(events().at(-1)).toEqual({
          jsonrpc: '2.0',
          method: SPEECH_NOTIFICATION,
          params: { subscription: opened.subscription, event: null },
        }),
      );
      expect(events().at(-2)).toEqual({
        jsonrpc: '2.0',
        method: SPEECH_NOTIFICATION,
        params: { subscription: opened.subscription, event: utterance },
      });
      expect(await view.invoke({ action: 'speak', text: 'Bonjour' })).toEqual({
        status: 'spoken',
        provider: 'voice',
        model: 'small',
        voice: 'reader',
      });
      expect(spoken).toBe('Bonjour');
      expect([...BrowserAudio.current.sources[0]!.buffer!.samples[0]!]).toEqual([-1, 0, 32767 / 32768]);
      expect(BrowserAudio.current.state).toBe('closed');
    });
  }),
);

it.live('teardown releases recognition, and another mount cannot finish its capture', () =>
  Effect.gen(function* () {
    const view = yield* rig();
    yield* Effect.promise(async () => {
      const opened = (await view.invoke({ action: 'recognize' })) as { subscription: string };
      await view.changed.promise;
      await expect(view.invoke({ action: 'finish', subscription: opened.subscription }, new AbortController())).rejects.toMatchObject({
        code: INVALID_PARAMS,
      });
    });
    const socket = SpeechSocket.current;
    yield* view.close;
    yield* Effect.promise(() => socket.interrupted.promise);
    expect(socket.active.size).toBe(0);
  }),
);

it.live('a paused connection ends recognition visibly and its old subscription cannot restart or finish', () =>
  Effect.gen(function* () {
    const view = yield* rig();
    yield* Effect.promise(async () => {
      const opened = (await view.invoke({ action: 'recognize' })) as { subscription: string };
      await view.changed.promise;
      view.live.pause();
      expect(view.messages.at(-1)).toMatchObject({
        method: SPEECH_NOTIFICATION,
        params: {
          subscription: opened.subscription,
          failure: { code: 'connection' },
        },
      });
      view.live.resume();
      await expect(view.invoke({ action: 'finish', subscription: opened.subscription })).rejects.toMatchObject({ code: INVALID_PARAMS });
    });
  }),
);

it.live.each([true, false])('a suspended audio context speaks only when browser activation allows it: %s', (activated) =>
  Effect.gen(function* () {
    const view = yield* rig();
    BrowserAudio.initialState = 'suspended';
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: activated } });
    yield* Effect.promise(async () => {
      const speaking = view.invoke({ action: 'speak', text: 'Bonjour' });
      if (activated) expect(await speaking).toMatchObject({ status: 'spoken' });
      else await expect(speaking).rejects.toMatchObject({ code: -32000 });
      expect(BrowserAudio.current.state).toBe('closed');
    });
  }),
);

it.live('paced speech does not hold up an independent recognition on the live connection', () =>
  Effect.gen(function* () {
    const view = yield* rig();
    const mounted = new AbortController();
    yield* Effect.addFinalizer(() => Effect.sync(() => mounted.abort()));
    BrowserAudio.automatic = false;
    SpeechSocket.frames = 40;
    yield* Effect.promise(async () => {
      const speaking = view.invoke({ action: 'speak', text: 'Bonjour' }, mounted);
      const refused = expect(speaking).rejects.toBeInstanceOf(Error);
      await waitUntil(() => BrowserAudio.current.sources.length >= 20);
      const recognition = (await view.invoke({ action: 'recognize' })) as { subscription: string };
      await view.changed.promise;
      expect(view.messages).toContainEqual({
        jsonrpc: '2.0',
        method: SPEECH_NOTIFICATION,
        params: { subscription: recognition.subscription, event: admitted },
      });
      mounted.abort();
      await refused;
    });
  }),
);

it.live.each(['silence', 'teardown'])('%s stops the browser voice while its audio is playing', (action) =>
  Effect.gen(function* () {
    const view = yield* rig();
    const mounted = new AbortController();
    yield* Effect.addFinalizer(() => Effect.sync(() => mounted.abort()));
    BrowserAudio.automatic = false;
    yield* Effect.promise(async () => {
      const speaking = view.invoke({ action: 'speak', text: 'Bonjour' }, mounted);
      const refused = expect(speaking).rejects.toBeInstanceOf(Error);
      await waitUntil(() => BrowserAudio.current.sources[0]?.playing === true);
      if (action === 'silence') {
        expect(await view.invoke({ action: 'silence' }, mounted)).toEqual({ status: 'stopped', voices: 1 });
      } else mounted.abort();
      await refused;
      expect(BrowserAudio.current.sources[0]!.stopped).toBe(true);
      expect(BrowserAudio.current.state).toBe('closed');
    });
  }),
);

it.live('a foreign MCP App gets unavailable for speech and an app cannot choose another project', () =>
  Effect.gen(function* () {
    const view = yield* rig();
    yield* Effect.promise(async () => {
      await expect(view.invoke({ action: 'status', projectId: 8 })).rejects.toMatchObject({
        code: INVALID_PARAMS,
      });
      const source = {};
      const posted: unknown[] = [];
      const bridge = new ViewBridge(
        { origin: 'http://proxy.test', source: () => source, post: (message) => posted.push(message) },
        { methods: {}, context: () => ({}) },
        { html: '', csp: {}, permissions: {} },
      );
      bridge.receive({
        source,
        origin: 'http://proxy.test',
        data: { jsonrpc: '2.0', id: 1, method: 'tagma/speech', params: { action: 'recognize' } },
      });
      expect(posted).toEqual([
        { jsonrpc: '2.0', id: 1, error: { code: UNAVAILABLE, message: 'unavailable', data: { method: 'tagma/speech' } } },
      ]);
      bridge.dispose();
    });
  }),
);

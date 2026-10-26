import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import { ThreadEntryUnreadable } from '@runlith/agent/transcript/kinds';
import { createFeedKinds } from '$lib/features/threads/native/feedRecords.js';
import { Effect, Schema } from 'effect';
import { PAIRING_ENDPOINT, PairedAnswer } from '@tagma/server/remote/contract/wire/access';
import { expect, test } from 'vitest';
import { makeRouter } from '@runlith/layer/testing';
import { Refusal } from './refusal.js';
import { Door } from './Door.js';
import { loadOperations } from './operation.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

await loadOperations();

let answer: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
const fetch = async (input: RequestInfo | URL, init?: RequestInit) => answer(input, init);
const doorOf = () => new Door(fetch, new ServerOrigin('http://tagma.test'), makeRouter());

test.each([
  { status: 409, code: 'no-source', gate: true },
  { status: 500, code: 'database', gate: false },
])('HTTP $status reaches the caller as Refusal', async ({ status, code, gate }) => {
  const body = { code, reason: 'The request cannot complete', unblock: ['Read the named owner'] };
  answer = () => Response.json(body, { status });
  const door = doorOf();
  const result = await door
    .ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: { project: '1' }, headers: {}, payload: {} }))
    .catch((error) => error);
  expect(result).toBeInstanceOf(Refusal);
  expect(result).toMatchObject({ ...body, gate });
});

test('evidence decodes installed product entries and retains a typed diagnostic for an unknown kind', async () => {
  const door = new Door(fetch, new ServerOrigin('http://tagma.test'), makeRouter(), createFeedKinds().wire());
  const entry = { type: 'transport', id: 'transport:1', from: 'terminal', to: 'acp', occurredAt: '' };
  answer = () => Response.json({ status: 'found', entry });
  expect(await door.perform('read_thread_entry', { threadId: ThreadId.make('t1'), entryId: entry.id }, {})).toEqual({
    status: 'found',
    entry,
  });
  answer = () => Response.json({ status: 'found', entry: { type: 'not-installed', id: 'other' } });
  const read = await door.perform('read_thread_entry', { threadId: ThreadId.make('t1'), entryId: 'other' }, {});
  expect(read.status).toBe('found');
  if (read.status !== 'found') return;
  expect(read.entry).toBeInstanceOf(ThreadEntryUnreadable);
  if (read.entry instanceof ThreadEntryUnreadable) expect(read.entry.refusal).toMatchObject({ type: 'not-installed', id: 'other' });
});

test('an operation input with an undefined optional reaches the server without that key', async () => {
  let sent: unknown;
  answer = async (input, init) => {
    sent = await new Request(input, init).json();
    return Response.json({ code: 'no-source', reason: 'refused', unblock: ['read'] }, { status: 409 });
  };
  const result = await doorOf()
    .perform('list_threads', { set: 'live', title: undefined }, {})
    .catch((error: unknown) => error);
  expect(result).toMatchObject({ code: 'no-source', gate: true });
  expect(sent).toEqual({ set: 'live' });
});

test.each([
  { account: undefined, body: {} },
  { account: null, body: { account: null } },
])('a nullable optional keeps absent and null apart on the wire: $account', async ({ account, body }) => {
  let sent: unknown;
  answer = async (input, init) => {
    sent = await new Request(input, init).json();
    return Response.json({ code: 'no-source', reason: 'refused', unblock: ['read'] }, { status: 409 });
  };
  const model = { threadId: ThreadId.make('t1'), provider: 'p', model: 'm', reasoning: null, switches: {} };
  await doorOf()
    .perform('set_thread_model', { ...model, account }, {})
    .catch(() => undefined);
  expect(sent).toEqual({ ...model, ...body });
});

test('a device refusal at the remote door reaches the caller with its code', async () => {
  const body = { code: 'device-unpaired', reason: 'this device is not paired with this server', unblock: ['pair it'] };
  answer = () => Response.json(body, { status: 401 });
  const result = await doorOf()
    .ask((api) => api.health.health())
    .catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Refusal);
  expect(result).toMatchObject(body);
});

test('the contract the server first answered under stands until an answer names another', async () => {
  let contract = 'a1';
  answer = () => Response.json([], { headers: { 'tagma-contract': contract } });
  const door = doorOf();
  await door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }));
  await door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }));
  expect(door.contractMoved).toBe(false);
  contract = 'b2';
  await door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }));
  expect(door.contractMoved).toBe(true);
});

test('the door is idle only while no ask is in flight', async () => {
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  answer = () => {
    started.resolve();
    return response.promise;
  };
  const door = doorOf();
  expect(door.idle).toBe(true);
  const asked = door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }));
  expect(door.idle).toBe(false);
  await started.promise;
  response.resolve(Response.json([]));
  await asked;
  expect(door.idle).toBe(true);
});

test('a failed connection is distinct from a server refusal and retains its cause', async () => {
  const cause = new TypeError('connection lost');
  answer = () => Promise.reject(cause);
  const door = doorOf();
  const result = await door
    .ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }))
    .catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Refusal);
  expect(result).toMatchObject({ code: 'transport', gate: false, cause });
});

test('a malformed fault is an HTTP failure and successful answers remain decoded', async () => {
  let broken = true;
  answer = () => (broken ? new Response('not json', { status: 502 }) : Response.json([]));
  const door = doorOf();
  await expect(
    door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} })),
  ).rejects.toMatchObject({
    code: 'http',
    gate: false,
  });
  broken = false;
  expect(await door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }))).toEqual(
    [],
  );
});

test('schema construction failures keep their diagnostic cause', async () => {
  class WireRow extends Schema.Class<WireRow>('WireRow')({ name: Schema.String }) {}
  const door = doorOf();
  const decode = Schema.decodeUnknownSync(WireRow);
  const result = await door.ask(() => Effect.sync(() => decode({ name: 1 }))).catch((error: unknown) => error);

  expect(result).toBeInstanceOf(Refusal);
  expect(result).toMatchObject({ code: 'http', gate: false });
  expect((result as Refusal).reason).toContain('Expected string');
  expect((result as Refusal).reason).toContain('["name"]');
});

test('aborting an ask interrupts its Effect fiber and runs cleanup', async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  let released = false;
  const door = doorOf();
  const result = door.ask(
    () =>
      Effect.callback<never>(() => {
        started.resolve();
        return Effect.sync(() => {
          released = true;
        });
      }),
    { signal: controller.signal },
  );
  const rejected = expect(result).rejects.toBeDefined();
  await started.promise;
  controller.abort();
  await rejected;
  expect(released).toBe(true);
});

test('the final keepalive request completes after cancellation while an earlier request aborts', async () => {
  const ordinary = new AbortController();
  const final = new AbortController();
  const requests: Request[] = [];
  const firstStarted = Promise.withResolvers<void>();
  const lastStarted = Promise.withResolvers<void>();
  const responses: { response: ReturnType<typeof Promise.withResolvers<Response>>; keepalive: boolean }[] = [];
  answer = (input, init) => {
    const request = new Request(input, init);
    const response = Promise.withResolvers<Response>();
    requests.push(request);
    (requests.length === 1 ? firstStarted : lastStarted).resolve();
    responses.push({ response, keepalive: init?.keepalive === true });
    request.signal.addEventListener('abort', () => response.reject(request.signal.reason), { once: true });
    return response.promise;
  };
  const door = doorOf();
  const earlier = door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }), {
    signal: ordinary.signal,
  });
  const rejected = expect(earlier).rejects.toBeDefined();
  await firstStarted.promise;
  door.markLeaving();
  const last = door.ask((api) => api.operations.perform({ params: { id: 'list_sessions' }, query: {}, headers: {}, payload: {} }), {
    signal: final.signal,
  });
  await lastStarted.promise;
  ordinary.abort();
  final.abort();
  await rejected;
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[1]!.signal.aborted).toBe(false);
  for (const { response, keepalive } of responses) {
    if (keepalive) response.resolve(Response.json([]));
    else response.reject(new Error('The document closed'));
  }
  expect(await last).toEqual([]);
});

test('a declared binary route is addressed on the server door, and its bytes or its refusal reach the reader', async () => {
  const door = doorOf();
  const address = door.address((routes) => routes.speech.peaks({ params: { id: 'call 1', track: 'mic' }, query: { project: '7' } }));
  expect(address).toBe('http://tagma.test/api/speech/listenings/call%201/tracks/mic/peaks?project=7');
  expect(door.address('/api/threads/t1/attachments/a.png', { project: '7' })).toBe(
    'http://tagma.test/api/threads/t1/attachments/a.png?project=7',
  );
  expect(door.address('data:image/png;base64,AAAA', { project: '7' })).toBe('data:image/png;base64,AAAA');
  answer = (input) => (String(input) === address ? new Response(new Uint8Array([1, 2, 3])) : new Response(null, { status: 404 }));
  expect(new Uint8Array(await (await door.bytes(address)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  answer = () => Response.json({ code: 'missing', reason: 'no peaks for this track', unblock: [] }, { status: 404 });
  await expect(door.bytes(address)).rejects.toMatchObject({ code: 'missing', reason: 'no peaks for this track', gate: true });
  answer = () => Response.json({ code: 'server-fault', reason: 'the read failed', unblock: [] }, { status: 500 });
  await expect(door.bytes(address)).rejects.toMatchObject({ code: 'server-fault', gate: false });
  const cut = new TypeError('connection lost');
  answer = () => new Response(new ReadableStream({ pull: (controller) => controller.error(cut) }));
  await expect(door.bytes(address)).rejects.toMatchObject({ code: 'transport', gate: false, cause: cut });
});

test('an endpoint outside the catalog is exchanged as JSON and its answer decoded by the caller’s schema', async () => {
  let sent: { method: string; url: string; body: unknown } | null = null;
  const paired = { device: { id: 'd1', name: 'iPhone', pairedAt: '2026-10-18T12:00:00.000Z', lastSeenAt: null }, machine: 'studio' };
  answer = async (input, init) => {
    const request = new Request(input, init);
    sent = { method: request.method, url: request.url, body: await request.json() };
    return Response.json(paired);
  };
  expect(await doorOf().exchange(PAIRING_ENDPOINT, { code: '123456' }, PairedAnswer)).toEqual(paired);
  expect(sent).toEqual({ method: 'POST', url: `http://tagma.test${PAIRING_ENDPOINT.path}`, body: { code: '123456' } });
});

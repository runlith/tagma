import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { once } from 'node:events';
import { Agent, createServer, type RequestListener } from 'node:http';
import type { Socket } from 'node:net';
import { Deferred, Effect, Exit, Scope, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { layer, RequestOptions } from './verbatim';

const listen = (handler: RequestListener, onConnection?: (socket: Socket) => void) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer(handler);
      if (onConnection !== undefined) server.on('connection', onConnection);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return server;
    }),
    (server) =>
      Effect.sync(() => {
        server.closeAllConnections();
        server.close();
      }),
  ).pipe(
    Effect.flatMap(
      Effect.fnUntraced(function* (server) {
        const address = server.address();
        if (!address || typeof address === 'string') return yield* Effect.die('Expected TCP address');
        return { server, port: address.port };
      }),
    ),
  );

const serveBun = (fetch: (request: Request) => Response) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  );

it.live('closing a request scope interrupts a response that stopped sending bytes', () =>
  Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
    const { port } = yield* listen((_request, response) => {
      response.writeHead(200);
      response.write('partial');
      response.once('close', () => Deferred.doneUnsafe(disconnected, Effect.void));
    });
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const result = yield* Effect.gen(function* () {
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const response = yield* client.get(`http://127.0.0.1:${port}`).pipe(Effect.provideService(Scope.Scope, scope));
      yield* Scope.close(scope, Exit.void);
      return yield* Effect.result(response.text);
    }).pipe(Effect.provide(layer), Effect.timeout('2 seconds'));
    expect(result).toMatchObject({ _tag: 'Failure', failure: { reason: { _tag: 'DecodeError' } } });
    yield* Deferred.await(disconnected).pipe(Effect.timeout('1 second'));
  }),
);

it.live('socket timeout and Effect cancellation both release requests waiting for headers', () =>
  Effect.gen(function* () {
    const sockets = new Set<Socket>();
    const released = yield* Deferred.make<void>();
    let closed = 0;
    const { port } = yield* listen(
      () => {},
      (socket) => {
        sockets.add(socket);
        socket.on('close', () => {
          sockets.delete(socket);
          if (++closed === 2) Deferred.doneUnsafe(released, Effect.void);
        });
      },
    );
    for (const timeout of ['socket', 'effect']) {
      const call = Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return yield* client.get(`http://127.0.0.1:${port}`);
      }).pipe(Effect.provide(layer));
      const result = yield* (
        timeout === 'socket'
          ? call.pipe(Effect.provideService(RequestOptions, { timeout: 25 }), Effect.timeout('2 seconds'))
          : call.pipe(Effect.timeout('25 millis'))
      ).pipe(Effect.result);
      expect(result).toMatchObject(
        timeout === 'socket'
          ? { _tag: 'Failure', failure: { reason: { _tag: 'TransportError', cause: { code: 'ETIMEDOUT' } } } }
          : { _tag: 'Failure', failure: { _tag: 'TimeoutError' } },
      );
    }
    yield* Deferred.await(released).pipe(Effect.timeout('1 second'));
    expect(sockets.size).toBe(0);
  }),
);

it.live('slow response consumers bound buffering and then receive every byte', () =>
  Effect.gen(function* () {
    const chunk = Buffer.alloc(64 * 1024, 7);
    const total = 1024 * chunk.length;
    let written = 0;
    const { port } = yield* listen((_request, response) => {
      const write = () => {
        while (written < total) {
          written += chunk.length;
          if (!response.write(chunk)) {
            response.once('drain', write);
            return;
          }
        }
        response.end();
      };
      write();
    });
    const bytes = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get(`http://127.0.0.1:${port}`);
      yield* Effect.sleep('100 millis');
      expect(written).toBeLessThan(total);
      let read = 0;
      yield* Stream.runForEach(response.stream, (chunk) =>
        Effect.sync(() => {
          read += chunk.byteLength;
        }),
      );
      return read;
    }).pipe(Effect.provide(layer), Effect.timeout('3 seconds'));
    expect(bytes).toBe(total);
  }),
);

it.live('a slow upload receiver bounds producer demand and cancellation releases it', () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const { port } = yield* listen((request) => {
      request.pause();
      Deferred.doneUnsafe(arrived, Effect.void);
    });
    let produced = 0;
    const chunk = Buffer.alloc(64 * 1024);
    const body = Stream.fromIterable(Array.from({ length: 1024 }, () => chunk)).pipe(
      Stream.rechunk(1),
      Stream.map((chunk) => {
        produced++;
        return chunk;
      }),
      Stream.ensuring(Deferred.succeed(released, undefined)),
    );
    const result = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return yield* client.execute(HttpClientRequest.post(`http://127.0.0.1:${port}`).pipe(HttpClientRequest.bodyStream(body)));
    }).pipe(Effect.provide(layer), Effect.timeout('150 millis'), Effect.result);
    yield* Deferred.await(arrived);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'TimeoutError' } });
    expect(produced).toBeLessThan(1024);
    yield* Deferred.await(released).pipe(Effect.timeout('1 second'));
  }),
);

it.live('an agent routes through an authenticated proxy and honors NO_PROXY', () =>
  Effect.gen(function* () {
    const proxy = yield* serveBun((request) => Response.json({ target: request.url, auth: request.headers.get('proxy-authorization') }));
    const direct = yield* serveBun(() => Response.json({ direct: true }));
    const agent = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new Agent({
            keepAlive: true,
            proxyEnv: {
              HTTP_PROXY: `http://reader:secret@127.0.0.1:${proxy.port}`,
              NO_PROXY: '127.0.0.1',
            },
          }),
      ),
      (opened) => Effect.sync(() => opened.destroy()),
    );
    const answers = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const proxied = yield* client.get('http://localhost:1/v1/token?test=1');
      const first = yield* proxied.json;
      const bypassed = yield* client.get(`http://127.0.0.1:${direct.port}`);
      return [first, yield* bypassed.json];
    }).pipe(Effect.provide(layer), Effect.provideService(RequestOptions, { agent }), Effect.timeout('2 seconds'));
    expect(answers).toEqual([{ target: 'http://localhost:1/v1/token?test=1', auth: `Basic ${btoa('reader:secret')}` }, { direct: true }]);
  }),
);

it.live('completed requests reuse the connection and layer disposal closes its pool', () =>
  Effect.gen(function* () {
    let connections = 0;
    const disconnected = yield* Deferred.make<void>();
    const { port } = yield* listen(
      (_request, response) => response.end('ok'),
      (socket) => {
        connections++;
        socket.once('close', () => Deferred.doneUnsafe(disconnected, Effect.void));
      },
    );
    yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      for (let i = 0; i < 3; i++) {
        const response = yield* client.get(`http://127.0.0.1:${port}`);
        expect(yield* response.text).toBe('ok');
      }
    }).pipe(Effect.provide(layer), Effect.timeout('2 seconds'));
    expect(connections).toBe(1);
    yield* Deferred.await(disconnected).pipe(Effect.timeout('1 second'));
  }),
);

it.live('default pools read proxy environment and bypass settings', () =>
  Effect.gen(function* () {
    const proxy = yield* serveBun(() => new Response('proxy'));
    const direct = yield* serveBun(() => new Response('direct'));
    const script = `
    import { Effect } from 'effect';
    import { HttpClient } from 'effect/http';
    import { layer } from ${JSON.stringify(new URL('./verbatim.ts', import.meta.url).href)};
    const answer = await Effect.runPromise(Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const proxied = yield* client.get('http://localhost:1');
      const first = yield* proxied.text;
      const bypassed = yield* client.get('http://127.0.0.1:${direct.port}');
      return [first, yield* bypassed.text];
    }).pipe(Effect.provide(layer), Effect.timeout('2 seconds')));
    console.log(JSON.stringify(answer));
  `;
    for (const name of ['HTTP_PROXY', 'ALL_PROXY']) {
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([process.execPath, '--eval', script], {
            cwd: new URL('../../../..', import.meta.url).pathname,
            env: {
              ...process.env,
              HTTP_PROXY: '',
              http_proxy: '',
              HTTPS_PROXY: '',
              https_proxy: '',
              ALL_PROXY: '',
              all_proxy: '',
              NODE_USE_ENV_PROXY: '0',
              NO_PROXY: '127.0.0.1',
              no_proxy: '',
              [name]: `http://127.0.0.1:${proxy.port}`,
            },
            stdout: 'pipe',
            stderr: 'pipe',
          }),
        ),
        (spawned) => Effect.sync(() => spawned.kill()),
      );
      const [exit, stdout, stderr] = yield* Effect.promise(() =>
        Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
      );
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
      expect(JSON.parse(stdout)).toEqual(['proxy', 'direct']);
    }
  }),
);

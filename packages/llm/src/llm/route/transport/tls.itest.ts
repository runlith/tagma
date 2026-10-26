import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Agent } from 'node:https';
import { connect } from 'node:net';
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';
import { layer, RequestOptions } from './verbatim';

const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgi03sJJqhy8MOebnA
LcE1oYrJDCpl5xJkA5AvKfelXi+hRANCAATy6GA2bHlSfn58bYsr7gRwbYnHBk9A
V1DvfqK32U3yJ65HfEYl62QHZtnoFh/L3rLeCV4a8PBDKakiZJa3+edG
-----END PRIVATE KEY-----`;
const cert = `-----BEGIN CERTIFICATE-----
MIIBlTCCATugAwIBAgIUMwyK8PUy9swWWzpFvY/5rHGppUAwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDkyMTE2NDczMloYDzIxMjYwODI4
MTY0NzMyWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAATy6GA2bHlSfn58bYsr7gRwbYnHBk9AV1DvfqK32U3yJ65HfEYl62QH
ZtnoFh/L3rLeCV4a8PBDKakiZJa3+edGo2kwZzAdBgNVHQ4EFgQUzskQdoXb3uuf
QWuSIt535Y/Qr64wHwYDVR0jBBgwFoAUzskQdoXb3uufQWuSIt535Y/Qr64wDwYD
VR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZIzj0EAwID
SAAwRQIhAN1MRgAW8kbwCwVN7Daz6C2PBcmFSqxhvPceUpMUyS2AAiB/BXsZKdaj
qJ/x0CpeKXROCtWmrJQuC+OgUGRfCm2tMQ==
-----END CERTIFICATE-----`;

it.live('TLS verifies certificates, accepts an explicit CA, and traverses an authenticated CONNECT proxy', () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          tls: { key, cert },
          fetch: (request) => Response.json({ secured: true, proxyAuth: request.headers.get('proxy-authorization') }),
        }),
      ),
      (running) => Effect.promise(() => running.stop(true)),
    );
    const tunnels: Array<{ target: string | undefined; auth: string | undefined }> = [];
    const sockets = new Set<import('node:stream').Duplex>();
    const proxy = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const opened = createServer();
        opened.on('connect', (request, downstream, head) => {
          tunnels.push({ target: request.url, auth: request.headers['proxy-authorization'] });
          const upstream = connect({ host: '127.0.0.1', port: server.port! }, () => {
            downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.write(head);
            downstream.pipe(upstream).pipe(downstream);
          });
          for (const socket of [upstream, downstream]) {
            sockets.add(socket);
            socket.on('close', () => {
              sockets.delete(socket);
              upstream.destroy();
              downstream.destroy();
            });
            socket.on('error', () => {
              upstream.destroy();
              downstream.destroy();
            });
          }
        });
        opened.listen(0, '127.0.0.1');
        await once(opened, 'listening');
        return opened;
      }),
      (opened) =>
        Effect.sync(() => {
          for (const socket of sockets) socket.destroy();
          opened.close();
        }),
    );
    const address = proxy.address();
    if (!address || typeof address === 'string') return yield* Effect.die('Expected TCP address');
    const agent = yield* Effect.acquireRelease(
      Effect.sync(() => new Agent({ proxyEnv: { HTTPS_PROXY: `http://reader:secret@127.0.0.1:${address.port}` } })),
      (opened) => Effect.sync(() => opened.destroy()),
    );
    const call = Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get(`https://localhost:${server.port}`);
      return yield* response.json;
    }).pipe(Effect.provide(layer), Effect.timeout('2 seconds'));

    const rejected = yield* call.pipe(Effect.provideService(RequestOptions, { family: 4 }), Effect.result);
    expect(rejected).toMatchObject({ _tag: 'Failure', failure: { reason: { _tag: 'TransportError' } } });
    const trusted = yield* call.pipe(Effect.provideService(RequestOptions, { ca: cert, family: 4 }));
    expect(trusted).toEqual({ secured: true, proxyAuth: null });
    const proxied = yield* call.pipe(Effect.provideService(RequestOptions, { agent, ca: cert, family: 4 }));
    expect(proxied).toEqual({ secured: true, proxyAuth: null });
    expect(tunnels).toEqual([{ target: `localhost:${server.port}`, auth: `Basic ${btoa('reader:secret')}` }]);
  }),
);

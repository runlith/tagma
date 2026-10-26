import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Cause, Effect, FileSystem, Layer, Schema } from 'effect';
import { HostMessage, WIRE_MAGIC, WIRE_RANGE, WIRE_VERSION } from '@runlith/executions/protocol/wire';
import { encodeFrame, frameReader } from '@runlith/executions/protocol/frames';
import { hostWireLimits, registrationOf } from '../../hostFixture';
import { Adapter } from '../../holder/testing/Adapter';
import { Host } from './session';
import { hosted } from './host';
import { posix } from './posix';

const text = new TextEncoder();
const chars = new TextDecoder();
const message = Schema.decodeUnknownOption(HostMessage);

layer(hosted('POSIX', posix(), { executions: 24, nofile: 36 }).layer.pipe(Layer.merge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('POSIX welcome limits', (it) => {
  it.effect('welcome subscriptions use the initialized profile rather than its bootstrap upper bound', () =>
    Effect.gen(function* () {
      const host = yield* Host;
      const adapter = yield* Adapter;
      const files = yield* FileSystem.FileSystem;
      const profile = yield* host.client.capabilities();
      const registration = registrationOf(adapter.directory);
      const limits = hostWireLimits(profile, 24, { envelopeBytes: 1024 * 1024, connections: 2, requests: 4 });
      const reader = frameReader(limits);
      const frame = (body: unknown) => encodeFrame(text.encode(JSON.stringify(body)), new Uint8Array());
      const preface = frame({ magic: WIRE_MAGIC, wire: WIRE_RANGE });
      const hello = frame({
        v: WIRE_VERSION,
        body: 'bytes',
        message: {
          _tag: 'Hello',
          request: 0,
          installation: registration.installation,
          protocol: registration.protocol,
          role: 'custodian',
          secret: (yield* files.readFileString(registration.credentials.custodian)).trimEnd(),
          client: { name: 'quota-test', version: '1' },
        },
      });
      const welcome = yield* Effect.callback<Extract<HostMessage, { _tag: 'Welcome' }>, Cause.UnknownError>((resume) => {
        let close: (() => void) | undefined;
        let closed = false;
        let welcomed = false;
        const refuse = (cause: unknown) => resume(Effect.fail(new Cause.UnknownError(cause, String(cause))));
        Bun.connect({
          unix: registration.endpoint.path,
          socket: {
            open(socket) {
              close = () => socket.end();
              if (closed) {
                socket.end();
                return;
              }
              socket.write(Buffer.concat([preface, hello]));
            },
            data(socket, bytes) {
              const read = reader.push(bytes);
              if (read._tag === 'Fault') {
                socket.end();
                refuse(new Error(read.fault.detail));
                return;
              }
              for (const frame of read.frames) {
                const header = JSON.parse(chars.decode(frame.header));
                const parsed = message(header.body === 'json' ? JSON.parse(chars.decode(frame.payload)) : header.message);
                frame.release();
                if (parsed._tag === 'Some' && parsed.value._tag === 'Welcome') {
                  welcomed = true;
                  socket.end();
                  resume(Effect.succeed(parsed.value));
                }
              }
            },
            error(socket, error) {
              socket.end();
              refuse(error);
            },
            close() {
              if (!welcomed) refuse(new Error('the host closed before welcome'));
            },
          },
        }).catch(refuse);
        return Effect.sync(() => {
          closed = true;
          close?.();
        });
      });
      expect(welcome.profile.ceilings.perTransport.pipes).toBeLessThan(24);
      expect(welcome.limits.subscriptions).toBe(welcome.profile.ceilings.readers);
    }),
  );
});

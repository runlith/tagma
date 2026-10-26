import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect } from 'effect';
import { connect } from './Connection';
import type { Link } from './Link';

type Loss = 'launch-reply' | 'rollback-refused';
type Packet = { readonly bytes: Uint8Array; readonly handles: readonly number[]; readonly capacity: boolean };
const word = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};
const long = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
};
const text = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return Buffer.concat([word(bytes.length), bytes]);
};
const frame = (op: number, request: number, ...parts: readonly Uint8Array[]) => {
  const body = Buffer.concat([Uint8Array.of(op), word(request), ...parts]);
  return Buffer.concat([word(body.length), body]);
};
const channel = (loss: Loss): Link => {
  const packets: Packet[] = [
    {
      bytes: frame(128, 0, word(42), word(0), Uint8Array.of(0, 1, 3), word(0), word(0), Uint8Array.of(1), long(0)),
      handles: [7],
      capacity: false,
    },
  ];
  let offset = 0;
  let closed = false;
  let wake = Deferred.makeUnsafe<void>();
  const changed = () => {
    Deferred.doneUnsafe(wake, Effect.void);
    wake = Deferred.makeUnsafe<void>();
  };
  return {
    copies: { pty: 0, pipes: 0 },
    receive: Effect.fnUntraced(function* (landing) {
      while (packets.length === 0 && !closed) yield* Deferred.await(wake);
      const packet = packets[0];
      if (packet === undefined) return { count: 0, handles: [], capacity: false };
      const count = Math.min(landing.length, packet.bytes.length - offset);
      landing.set(packet.bytes.subarray(offset, offset + count));
      const handles = offset === 0 ? packet.handles : [];
      offset += count;
      if (offset === packet.bytes.length) {
        packets.shift();
        offset = 0;
      }
      return { count, handles, capacity: packet.capacity };
    }),
    write: (bytes) =>
      Effect.sync(() => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const request = view.getUint32(5, true);
        if (bytes[4] === 1) {
          if (loss === 'launch-reply') closed = true;
          else {
            const size = view.getUint32(9, true);
            const id = new TextDecoder().decode(bytes.subarray(13, 13 + size));
            packets.push({
              bytes: frame(130, request, text(id), word(43), word(43), text(''), text('birth'), Uint8Array.of(2, 0, 0, 0, 0, 1), word(0)),
              handles: [],
              capacity: true,
            });
          }
        } else if (bytes[4] === 2)
          packets.push({
            bytes: frame(133, request, Uint8Array.of(13), text('the rollback signal was denied')),
            handles: [],
            capacity: false,
          });
        else throw new Error(`unexpected request ${bytes[4]}`);
        changed();
        return bytes.length;
      }),
    close: () => {
      closed = true;
      changed();
    },
    discard: () => {},
    terminal: () => {
      throw new Error('the uncertain launch delivers no usable terminal');
    },
    pipe: () => {
      throw new Error('the uncertain launch delivers no usable pipe');
    },
    workState: () => 'unmeasured',
    prepare: (launch) => Effect.succeed(launch),
  };
};

for (const loss of ['launch-reply', 'rollback-refused'] as const) {
  it.effect(`${loss}: the holder client preserves uncertainty after sending a launch it cannot disprove`, () =>
    Effect.gen(function* () {
      const holder = yield* connect(channel(loss));
      expect(
        yield* Effect.flip(
          holder.launch({
            id: 'uncertain-launch',
            path: '/bin/cat',
            argv: ['/bin/cat'],
            env: [],
            cwd: '/',
            transport: { _tag: 'pipes', stdin: 'ignore' },
            pace: 'full',
          }),
        ),
      ).toMatchObject({ _tag: 'HolderLaunchUncertain', execution: 'uncertain-launch' });
    }),
  );
}

import { Effect } from 'effect';
import { frameSize, HEADER_FIELD, SIZE_FIELD, type WireFault, type WireLimits } from './wire';

export const encodeFrame = (header: Uint8Array, payload: Uint8Array): Uint8Array => {
  const size = frameSize(header.length, payload.length);
  const frame = new Uint8Array(SIZE_FIELD + size);
  const view = new DataView(frame.buffer);
  view.setUint32(0, size);
  view.setUint32(SIZE_FIELD, header.length);
  frame.set(header, SIZE_FIELD + HEADER_FIELD);
  frame.set(payload, SIZE_FIELD + HEADER_FIELD + header.length);
  return frame;
};

export type WireFrame = {
  readonly header: Uint8Array;
  readonly payload: Uint8Array;
  readonly release: () => void;
};

export type FrameRead =
  | { readonly _tag: 'Frames'; readonly frames: ReadonlyArray<WireFrame> }
  | { readonly _tag: 'Fault'; readonly fault: WireFault };

export type FrameReader = { readonly push: (chunk: Uint8Array) => FrameRead };

export const EMPTY_PAYLOAD = new Uint8Array(0);

export const YIELD_FRAME_BYTES = 64 * 1024;

export const frameReader = (limits: WireLimits): FrameReader => {
  const held: Array<Uint8Array> = [];
  let first = 0;
  let within = 0;
  let pending = 0;
  let faulted: WireFault | undefined;
  let pinned = 0;
  let views = 0;
  const prefix = new Uint8Array(SIZE_FIELD + HEADER_FIELD);

  const COMPACT_AT = 64;

  const compact = () => {
    const drop = Math.min(pinned, first);
    if (drop <= 0) return;
    if (drop < COMPACT_AT && drop < held.length) return;
    held.splice(0, drop);
    first -= drop;
    pinned -= drop;
  };

  const peek = (count: number, out: Uint8Array) => {
    let written = 0;
    let at = first;
    let offset = within;
    while (written < count && at < held.length) {
      const chunk = held[at] as Uint8Array;
      const available = chunk.length - offset;
      const wanted = count - written;
      const taking = available <= wanted ? available : wanted;
      out.set(chunk.subarray(offset, offset + taking), written);
      written += taking;
      at += 1;
      offset = 0;
    }
  };

  const advance = (count: number) => {
    let left = count;
    while (left > 0 && first < held.length) {
      const chunk = held[first] as Uint8Array;
      const available = chunk.length - within;
      const taking = available <= left ? available : left;
      within += taking;
      left -= taking;
      if (within === chunk.length) {
        first += 1;
        within = 0;
      }
    }
    pending -= count;
    compact();
  };

  const u32At = (bytes: Uint8Array, offset: number): number =>
    (bytes[offset] ?? 0) * 0x1000000 + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);

  const region = (count: number): { readonly bytes: Uint8Array; readonly release: () => void } => {
    if (count === 0) return { bytes: EMPTY_PAYLOAD, release: () => {} };
    const chunk = held[first] as Uint8Array | undefined;
    if (chunk !== undefined && chunk.length - within >= count) {
      const at = first;
      const bytes = chunk.subarray(within, within + count);
      if (views === 0 || at < pinned) pinned = at;
      views += 1;
      let live = true;
      const release = () => {
        if (!live) return;
        live = false;
        views -= 1;
        if (views === 0) pinned = first;
        compact();
      };
      advance(count);
      return { bytes, release };
    }
    const bytes = new Uint8Array(count);
    peek(count, bytes);
    advance(count);
    return { bytes, release: () => {} };
  };

  const fault = (kind: WireFault['kind'], detail: string): FrameRead => {
    faulted = { kind, detail };
    held.length = 0;
    first = 0;
    within = 0;
    pending = 0;
    pinned = 0;
    views = 0;
    return { _tag: 'Fault', fault: faulted };
  };

  return {
    push: (chunk) => {
      if (faulted !== undefined) return { _tag: 'Fault', fault: faulted };
      if (chunk.length > 0) {
        held.push(chunk);
        pending += chunk.length;
      }
      const frames: Array<WireFrame> = [];
      while (pending >= SIZE_FIELD) {
        peek(SIZE_FIELD, prefix);
        const size = u32At(prefix, 0);
        if (size > limits.frameBytes) {
          return fault('oversized', `frame of ${size} bytes exceeds the ${limits.frameBytes} byte ceiling`);
        }
        if (size < HEADER_FIELD) return fault('malformed', `frame of ${size} bytes carries no header length`);
        if (pending < SIZE_FIELD + size) break;
        peek(SIZE_FIELD + HEADER_FIELD, prefix);
        const headerLength = u32At(prefix, SIZE_FIELD);
        if (headerLength === 0) return fault('malformed', 'frame carries an empty header');
        if (headerLength > size - HEADER_FIELD) {
          return fault('malformed', `header of ${headerLength} bytes does not fit a frame of ${size}`);
        }
        if (headerLength > limits.headerBytes) {
          return fault('oversized', `header of ${headerLength} bytes exceeds the ${limits.headerBytes} byte envelope`);
        }
        advance(SIZE_FIELD + HEADER_FIELD);
        const header = region(headerLength);
        const payload = region(size - HEADER_FIELD - headerLength);
        let released = false;
        frames.push({
          header: header.bytes,
          payload: payload.bytes,
          release: () => {
            if (released) return;
            released = true;
            header.release();
            payload.release();
          },
        });
      }
      return { _tag: 'Frames', frames };
    },
  };
};

export const WIRE_TAKE_SPAN = 'wire.framereader.take';
export const WIRE_DISPATCH_SPAN = 'wire.read.dispatch';

export const takeFrames = <E, R>(
  reader: FrameReader,
  chunk: Uint8Array,
  body: (read: FrameRead) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R> =>
  Effect.withSpan(
    Effect.suspend(() => {
      const read = reader.push(chunk);
      const taken =
        read._tag === 'Frames' ? read.frames.reduce((sum, frame) => sum + frameSize(frame.header.length, frame.payload.length), 0) : 0;
      const release = () => {
        if (read._tag !== 'Frames') return;
        for (const frame of read.frames) frame.release();
      };
      return Effect.andThen(Effect.annotateCurrentSpan({ bytes: taken }), body(read).pipe(Effect.ensuring(Effect.sync(release))));
    }),
    WIRE_TAKE_SPAN,
    { root: true },
  );

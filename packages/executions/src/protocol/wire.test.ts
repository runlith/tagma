import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { needing } from './capability';
import { ExecutionId, InstallationId } from './execution';
import {
  ClientFrame,
  clientOpening,
  fatalFault,
  frameSize,
  HostFrame,
  HostMessageText,
  peekWireVersion,
  unsupported,
  WIRE_MAGIC,
  WIRE_RANGE,
  WIRE_VERSION,
  type WireLimits,
  wireLimits,
  WirePreface,
  wireSkewDetail,
  wireVersionOf,
} from './wire';
import { EMPTY_PAYLOAD, encodeFrame, frameReader } from './frames';

const limits: WireLimits = { frameBytes: 64, headerBytes: 24, connections: 2, requests: 2, subscriptions: 2, credits: 2 };

const bytes = (...values: ReadonlyArray<number>) => new Uint8Array(values);

const prefixed = (size: number, headerLength: number, rest: Uint8Array) => {
  const frame = new Uint8Array(8 + rest.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, size);
  view.setUint32(4, headerLength);
  frame.set(rest, 8);
  return frame;
};

it('refuses a foreground read unless the host announces terminal-foreground', () => {
  const request = {
    _tag: 'Foreground' as const,
    execution: { installation: InstallationId.make('host'), execution: ExecutionId.make('terminal'), incarnation: 1 },
  };
  expect(unsupported(request, new Set())).toMatchObject({ _tag: 'UnsupportedCapability', capability: 'terminal-foreground' });
  expect(unsupported(request, new Set(['terminal-foreground']))).toBeUndefined();
});

describe('execution wire framing', () => {
  it('refuses an oversized frame from its length alone, before the frame exists', () => {
    const reader = frameReader(limits);
    const declared = new Uint8Array(4);
    new DataView(declared.buffer).setUint32(0, limits.frameBytes + 1);

    const read = reader.push(declared);

    expect(read._tag).toBe('Fault');
    if (read._tag !== 'Fault') return;
    expect(read.fault.kind).toBe('oversized');
    expect(fatalFault(read.fault)).toBe(true);
  });

  it('refuses a header that does not fit the frame that declares it', () => {
    const reader = frameReader(limits);
    const read = reader.push(prefixed(8, 32, bytes(1, 2, 3, 4)));

    expect(read._tag).toBe('Fault');
    if (read._tag !== 'Fault') return;
    expect(read.fault.kind).toBe('malformed');
  });

  it('refuses an empty header', () => {
    const reader = frameReader(limits);
    const read = reader.push(prefixed(4, 0, EMPTY_PAYLOAD));

    expect(read._tag).toBe('Fault');
    if (read._tag !== 'Fault') return;
    expect(read.fault.kind).toBe('malformed');
  });

  it('answers the same fault to every later push, because the stream has no next boundary', () => {
    const reader = frameReader(limits);
    const first = reader.push(prefixed(4, 0, EMPTY_PAYLOAD));
    const second = reader.push(encodeFrame(bytes(1), bytes(2)));

    expect(first._tag).toBe('Fault');
    expect(second._tag).toBe('Fault');
    if (first._tag !== 'Fault' || second._tag !== 'Fault') return;
    expect(second.fault).toEqual(first.fault);
  });

  it('reassembles one frame split across arbitrary chunk boundaries, byte for byte', () => {
    const header = bytes(11, 12, 13, 14, 15);
    const payload = bytes(21, 22, 23, 24, 25, 26, 27);
    const frame = encodeFrame(header, payload);
    const reader = frameReader(limits);

    const seen = [];
    for (let index = 0; index < frame.length; index += 1) {
      const read = reader.push(frame.subarray(index, index + 1));
      expect(read._tag).toBe('Frames');
      if (read._tag !== 'Frames') return;
      seen.push(...read.frames);
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]?.header).toEqual(header);
    expect(seen[0]?.payload).toEqual(payload);
  });

  it('reassembles consecutive frames across more chunks than it keeps at once', () => {
    const frames = [
      encodeFrame(bytes(1, 2, 3), new Uint8Array(40).fill(7)),
      encodeFrame(bytes(4, 5), new Uint8Array(30).fill(9)),
      encodeFrame(bytes(6), new Uint8Array(50).fill(3)),
    ];
    const reader = frameReader(limits);
    const joined = new Uint8Array(frames.reduce((held, frame) => held + frame.length, 0));
    let at = 0;
    for (const frame of frames) {
      joined.set(frame, at);
      at += frame.length;
    }
    expect(joined.length).toBeGreaterThan(64 * 2);

    const seen = [];
    for (let index = 0; index < joined.length; index += 1) {
      const read = reader.push(joined.subarray(index, index + 1));
      expect(read._tag).toBe('Frames');
      if (read._tag !== 'Frames') return;
      seen.push(...read.frames);
    }

    expect(seen.map((frame) => frame.header)).toEqual([bytes(1, 2, 3), bytes(4, 5), bytes(6)]);
    expect(seen[0]?.payload).toEqual(new Uint8Array(40).fill(7));
    expect(seen[1]?.payload).toEqual(new Uint8Array(30).fill(9));
    expect(seen[2]?.payload).toEqual(new Uint8Array(50).fill(3));
  });

  it('takes every whole frame out of one chunk and keeps the partial one for the next', () => {
    const first = encodeFrame(bytes(1, 2), bytes(3));
    const second = encodeFrame(bytes(4), EMPTY_PAYLOAD);
    const third = encodeFrame(bytes(5, 6, 7), bytes(8, 9));
    const reader = frameReader(limits);

    const joined = new Uint8Array(first.length + second.length + third.length - 2);
    joined.set(first, 0);
    joined.set(second, first.length);
    joined.set(third.subarray(0, third.length - 2), first.length + second.length);

    const read = reader.push(joined);
    expect(read._tag).toBe('Frames');
    if (read._tag !== 'Frames') return;
    expect(read.frames.map((frame) => frame.header)).toEqual([bytes(1, 2), bytes(4)]);

    const rest = reader.push(third.subarray(third.length - 2));
    expect(rest._tag).toBe('Frames');
    if (rest._tag !== 'Frames') return;
    expect(rest.frames[0]?.header).toEqual(bytes(5, 6, 7));
    expect(rest.frames[0]?.payload).toEqual(bytes(8, 9));
  });

  it('carries a frame exactly at the ceiling and refuses the next byte', () => {
    const header = bytes(1);
    const payload = new Uint8Array(limits.frameBytes - frameSize(header.length, 0));
    expect(frameSize(header.length, payload.length)).toBe(limits.frameBytes);

    const carried = frameReader(limits).push(encodeFrame(header, payload));
    expect(carried._tag).toBe('Frames');

    const refused = frameReader(limits).push(encodeFrame(header, new Uint8Array(payload.length + 1)));
    expect(refused._tag).toBe('Fault');
  });

  it('refuses a header past the envelope this side declared, at the frame', () => {
    const reader = frameReader(limits);
    const read = reader.push(prefixed(limits.headerBytes + 5, limits.headerBytes + 1, new Uint8Array(limits.headerBytes + 1)));

    expect(read._tag).toBe('Fault');
    if (read._tag !== 'Fault') return;
    expect(read.fault.kind).toBe('oversized');
    expect(fatalFault(read.fault)).toBe(true);
  });

  it('answers a frame as a view into the bytes that arrived, released once the frame is done with', () => {
    const header = bytes(1, 2, 3);
    const payload = bytes(4, 5);
    const frame = encodeFrame(header, payload);
    const reader = frameReader(limits);

    const read = reader.push(frame);
    expect(read._tag).toBe('Frames');
    if (read._tag !== 'Frames') return;
    const first = read.frames[0];
    expect(first?.header).toEqual(header);
    expect(first?.payload).toEqual(payload);
    expect(first?.header.buffer).toBe(frame.buffer);
    expect(first?.payload.buffer).toBe(frame.buffer);
    first?.release();

    const split = frameReader(limits);
    const part = split.push(frame.subarray(0, 4));
    expect(part._tag).toBe('Frames');
    if (part._tag !== 'Frames') return;
    expect(part.frames).toHaveLength(0);
    const rest = split.push(frame.subarray(4));
    expect(rest._tag).toBe('Frames');
    if (rest._tag !== 'Frames') return;
    expect(rest.frames[0]?.header).toEqual(header);
    expect(rest.frames[0]?.payload).toEqual(payload);
    rest.frames[0]?.release();
  });
});

const encodeClient = Schema.encodeSync(Schema.fromJsonString(ClientFrame));
const decodeClient = Schema.decodeUnknownSync(Schema.fromJsonString(ClientFrame));
const encodeHost = Schema.encodeSync(Schema.fromJsonString(HostFrame));
const decodeHost = Schema.decodeUnknownSync(Schema.fromJsonString(HostFrame));
const encodeHostMessage = Schema.encodeSync(HostMessageText);
const decodeHostMessage = Schema.decodeUnknownSync(HostMessageText);

describe('execution wire messages', () => {
  it('carries a call and its withdrawal through JSON unchanged', () => {
    const call = {
      v: WIRE_VERSION,
      body: 'bytes' as const,
      message: {
        _tag: 'Call' as const,
        request: 7,
        installation: 'installation-1',
        incarnation: 3,
        epoch: 2,
        body: {
          _tag: 'Read' as const,
          cursor: { ref: { installation: 'installation-1', execution: 'e1', incarnation: 3 }, stream: 'stdout' as const, offset: '4096' },
          limit: 64,
        },
      },
    };
    expect(decodeClient(encodeClient(decodeClient(JSON.stringify(call))))).toEqual(decodeClient(JSON.stringify(call)));
  });

  it('keeps a byte offset past 2^53 exactly as it was written', () => {
    const offset = '9007199254740993';
    const call = decodeClient(
      JSON.stringify({
        v: WIRE_VERSION,
        body: 'bytes',
        message: {
          _tag: 'Call',
          request: 1,
          installation: 'installation-1',
          incarnation: 0,
          epoch: 0,
          body: {
            _tag: 'Read',
            cursor: { ref: { installation: 'installation-1', execution: 'e1', incarnation: 0 }, stream: 'pty', offset },
            limit: 1,
          },
        },
      }),
    );
    expect(encodeClient(call)).toContain(offset);
  });

  it('refuses a frame of another protocol version before its body is read', () => {
    expect(() =>
      decodeHost(
        JSON.stringify({
          v: WIRE_VERSION + 1,
          body: 'bytes',
          message: { _tag: 'Event', body: { _tag: 'Ended', subscription: 1, ending: 'closed' } },
        }),
      ),
    ).toThrow();
  });

  it('carries a message in the payload when its header would not fit the envelope', () => {
    const header = decodeHost(encodeHost({ v: WIRE_VERSION, body: 'json' as const }));
    expect(header.body).toBe('json');

    const message = { _tag: 'Fault' as const, fault: { kind: 'malformed' as const, detail: 'wide' } };
    expect(decodeHostMessage(encodeHostMessage({ ...message, request: undefined }))).toEqual(message);
  });

  it('carries a fault naming no request, which is how a connection is ended rather than one answer', () => {
    const frame = decodeHost(
      JSON.stringify({ v: WIRE_VERSION, body: 'bytes', message: { _tag: 'Fault', fault: { kind: 'unauthenticated', detail: 'no' } } }),
    );
    if (frame.body !== 'bytes') throw new Error('the header should have carried the message');
    expect(frame.message._tag).toBe('Fault');
    if (frame.message._tag !== 'Fault') return;
    expect(frame.message.request).toBeUndefined();
    expect(fatalFault(frame.message.fault)).toBe(false);
    expect(encodeHost(frame)).toContain('unauthenticated');
  });
});

const BREAKING_SHAPES: Readonly<Record<number, string>> = {
  39: 'sha256:fa12df20f709d3276cc505258eb3ad38dbe9d170500b8bd3055eadc9d0fd4280',
  40: 'sha256:c75c666e3f46b9a203af0f593be2d6909ec926a42a32c702d5f6c9d901638bb2',
};

type Json = { readonly [key: string]: unknown };
const NOTES = new Set(['title', 'description', 'examples', 'default', '$comment']);

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical((value as Json)[key])}`)
          .join(',')}}`
      : JSON.stringify(value);

const breakingShape = (shapes: ReadonlyArray<readonly [string, Schema.Top]>): string => {
  const project = (node: unknown, defs: Json, seen: ReadonlyArray<string>): unknown => {
    if (Array.isArray(node)) return node.map((child) => project(child, defs, seen));
    if (node === null || typeof node !== 'object') return node;
    const object = node as Json;
    const ref = object['$ref'];
    if (typeof ref === 'string') {
      const name = ref.split('/').pop() ?? ref;
      return seen.includes(name) ? { recursive: name } : project(defs[name], defs, [...seen, name]);
    }
    const gated = (arm: unknown): boolean => {
      const named = (arm as Json)['$ref'];
      const resolved = typeof named === 'string' ? (defs[named.split('/').pop() ?? ''] as Json) : (arm as Json);
      return typeof resolved?.['description'] === 'string' && resolved['description'].startsWith('needs the ');
    };
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object)) {
      if (NOTES.has(key)) continue;
      if (key === 'anyOf' && Array.isArray(value)) {
        out[key] = value
          .filter((arm) => !gated(arm))
          .map((arm) => canonical(project(arm, defs, seen)))
          .sort();
      } else if (key === 'properties') {
        const required = new Set(Array.isArray(object['required']) ? (object['required'] as ReadonlyArray<string>) : []);
        out[key] = Object.fromEntries(
          Object.entries(value as Json)
            .filter(([name]) => required.has(name) && !(name === 'v' && 'body' in (value as Json)))
            .map(([name, child]) => [name, project(child, defs, seen)]),
        );
      } else if (key === 'required' && Array.isArray(value)) {
        out[key] = [...value]
          .filter((name) => !(name === 'v' && 'properties' in object && 'body' in (object['properties'] as Json)))
          .sort();
      } else {
        out[key] = project(value, defs, seen);
      }
    }
    return out;
  };
  const projected = shapes.flatMap(([name, shape]) => {
    const document = Schema.toJsonSchemaDocument(shape) as unknown as { readonly schema: unknown; readonly definitions?: Json };
    return [name, canonical(project(document.schema, document.definitions ?? {}, []))];
  });
  return `sha256:${createHash('sha256').update(projected.join('\n')).digest('hex')}`;
};

const shapeOf = (schema: Schema.Top) => breakingShape([['schema', schema]]);

describe('what a wire version means', () => {
  const base = Schema.Struct({ a: Schema.String, b: Schema.optional(Schema.Number) });

  it('moves only for a change a reader of the previous release cannot read', () => {
    const shape = shapeOf(base);
    expect(shapeOf(Schema.Struct({ a: Schema.String, b: Schema.optional(Schema.Number), c: Schema.optional(Schema.String) }))).toBe(shape);
    expect(shapeOf(Schema.Struct({ a: Schema.String, b: Schema.String }))).not.toBe(shapeOf(Schema.Struct({ a: Schema.String })));
    expect(shapeOf(Schema.Struct({ a: Schema.String, b: Schema.optional(Schema.Number), c: Schema.String }))).not.toBe(shape);
    expect(shapeOf(Schema.Struct({ b: Schema.optional(Schema.Number) }))).not.toBe(shape);
    expect(shapeOf(Schema.Struct({ a: Schema.Number, b: Schema.optional(Schema.Number) }))).not.toBe(shape);
  });

  it('leaves an arm a capability gates out of the shape, and moves for an arm nothing gates', () => {
    const one = Schema.Struct({ _tag: Schema.Literal('One') });
    const two = Schema.Struct({ _tag: Schema.Literal('Two') });
    const union = (...arms: ReadonlyArray<Schema.Top>) => Schema.Union(arms as never);
    expect(shapeOf(union(one, needing('machine-load', two)))).toBe(shapeOf(union(one, needing('end-residual', two))));
    expect(shapeOf(union(one, needing('machine-load', two)))).not.toBe(shapeOf(union(one, two)));
  });

  it('is pinned for the number the frames and the preface carry', () => {
    const measured = breakingShape([
      ['client', ClientFrame],
      ['host', HostFrame],
      ['preface', WirePreface],
    ]);
    const pinned = BREAKING_SHAPES[WIRE_VERSION];
    expect(pinned, `no shape is pinned for wire version ${WIRE_VERSION}: pin ${measured}`).toBeDefined();
    expect(
      measured,
      `the wire changed in a way the previous release cannot read: raise WIRE_VERSION and pin ${measured} under the new number in this change, or make the change additive`,
    ).toBe(pinned ?? '');
  });
});

const encodePreface = Schema.encodeSync(Schema.fromJsonString(WirePreface));

describe('wire opening', () => {
  it('agrees the highest version both ranges hold, and none where they do not meet', () => {
    const wider = clientOpening(encodePreface({ magic: WIRE_MAGIC, wire: { min: WIRE_RANGE.min, max: WIRE_RANGE.max + 3 } }));
    expect(wider).toEqual({ _tag: 'Preface', agreed: WIRE_RANGE.max });

    const newer = clientOpening(encodePreface({ magic: WIRE_MAGIC, wire: { min: WIRE_RANGE.max + 1, max: WIRE_RANGE.max + 2 } }));
    expect(newer).toEqual({ _tag: 'Preface', agreed: undefined });
  });

  it('refuses a first frame that is no preface, naming the version it carries', () => {
    const first = (version: number) => JSON.stringify({ v: version, body: 'bytes', message: { _tag: 'Hello' } });
    expect(clientOpening(first(WIRE_RANGE.min - 1))).toEqual({ _tag: 'Unsupported', version: WIRE_RANGE.min - 1 });
    expect(clientOpening(first(WIRE_VERSION))).toEqual({ _tag: 'Unsupported', version: WIRE_VERSION });
  });

  it('reads a preface that is not a range, or a frame with no version, as malformed', () => {
    expect(clientOpening(JSON.stringify({ magic: WIRE_MAGIC, wire: { min: WIRE_VERSION + 1, max: WIRE_VERSION } }))._tag).toBe('Malformed');
    expect(clientOpening(JSON.stringify({ magic: 'another', wire: WIRE_RANGE }))._tag).toBe('Malformed');
    expect(clientOpening('not json')._tag).toBe('Malformed');
  });

  it('is a frame that declares no version, so a peer that reads versions refuses it rather than misreads it', () => {
    expect(peekWireVersion(encodePreface({ magic: WIRE_MAGIC, wire: WIRE_RANGE }))).toBeUndefined();
  });
});

describe('wire version skew', () => {
  it('reads the version a peer declares, whatever else its header says', () => {
    expect(peekWireVersion(JSON.stringify({ v: WIRE_VERSION - 1, message: {} }))).toBe(WIRE_VERSION - 1);
    expect(peekWireVersion(JSON.stringify({ v: WIRE_VERSION + 1, message: {} }))).toBe(WIRE_VERSION + 1);
    expect(peekWireVersion(JSON.stringify({ v: WIRE_VERSION, message: {} }))).toBe(WIRE_VERSION);
  });

  it('answers nothing where no version was declared', () => {
    expect(peekWireVersion('not json')).toBeUndefined();
    expect(peekWireVersion(JSON.stringify({ message: {} }))).toBeUndefined();
    expect(peekWireVersion(JSON.stringify({ v: 'ten', message: {} }))).toBeUndefined();
    expect(peekWireVersion(JSON.stringify({ v: 0, message: {} }))).toBeUndefined();
    expect(peekWireVersion(JSON.stringify([WIRE_VERSION]))).toBeUndefined();
  });

  it('reads the same version from a header already parsed as from its text', () => {
    const headers = [
      { v: WIRE_RANGE.min, message: {} },
      { v: WIRE_VERSION, body: 'json' },
      { v: WIRE_VERSION + 1 },
      { message: {} },
      { v: 'ten' },
      { v: 0 },
      { v: 1.5 },
      [WIRE_VERSION],
      null,
      WIRE_VERSION,
    ];
    for (const header of headers) expect(wireVersionOf(header)).toBe(peekWireVersion(JSON.stringify(header)));
  });

  it('names both ranges in one sentence', () => {
    const said = wireSkewDetail({ min: WIRE_VERSION + 1, max: WIRE_VERSION + 2 }, WIRE_RANGE);
    expect(said).toContain(`${WIRE_VERSION + 1}`);
    expect(said).toContain(`${WIRE_VERSION + 2}`);
    expect(said).toContain(`${WIRE_RANGE.max}`);
  });
});

describe('wire limits', () => {
  it('derives the frame ceiling from the largest payload the profile measured', () => {
    const profile = {
      execution: {
        read: { chunkBytes: 4096, readerCredits: 2048, readers: 5 },
        input: { chunkBytes: 1024 },
        frame: { bytes: 8192, inFlight: 2 },
      },
    } as never;

    const derived = wireLimits(profile, { envelopeBytes: 512, connections: 4, requests: 6, subscriptions: 40 });

    expect(derived.frameBytes).toBe(4 + 512 + 8192);
    expect(derived.subscriptions).toBe(40);
    expect(derived.connections).toBe(4);
    expect(derived.requests).toBe(6);
  });

  it('grants enough credit to buy one whole frame, envelope included', () => {
    const profile = {
      execution: {
        read: { chunkBytes: 4096, readerCredits: 4096, readers: 5 },
        input: { chunkBytes: 1024 },
        frame: { bytes: 1024, inFlight: 1 },
      },
    } as never;

    const derived = wireLimits(profile, { envelopeBytes: 512, connections: 1, requests: 1, subscriptions: 8 });

    expect(derived.credits).toBe(4 + 512 + 4096);
  });
});

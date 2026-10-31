import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { announced, CAPABILITIES, capabilityOf } from './capability';
import { EndingReceipt, FinalFacts, recordedEnding } from './stop';
import corpus from './wireCorpus.json';
import {
  ClientFrame,
  ClientMessageText,
  clientOpening,
  HostFrame,
  HostMessage,
  PREVIOUS_RELEASE,
  Request,
  requiredCapability,
  servedOn,
  unknownEvent,
  unsupported,
  unsupportedCall,
  WIRE_VERSION,
  WirePreface,
} from './wire';
import { encodeFrame, frameReader } from './frames';

type Recorded = { readonly side: string; readonly header: string; readonly payload: string };
type Release = { readonly frames: ReadonlyArray<Recorded>; readonly arms: ReadonlyArray<Recorded> };

const releases: ReadonlyArray<readonly [number, Release]> = [
  [PREVIOUS_RELEASE.version, corpus[PREVIOUS_RELEASE.version]],
  [WIRE_VERSION, corpus[WIRE_VERSION]],
];

const client = Schema.fromJsonString(ClientFrame);
const host = Schema.fromJsonString(HostFrame);
const codecOf = (side: string) => (side === 'client' ? client : host);
const isPreface = (header: string) => Schema.decodeUnknownOption(Schema.fromJsonString(WirePreface))(header)._tag === 'Some';
const payloadOf = (frame: Recorded) => new Uint8Array(Buffer.from(frame.payload, 'base64'));
const text = new TextEncoder();
const chars = new TextDecoder();

const limits = { frameBytes: 1 << 16, headerBytes: 1 << 14, connections: 1, requests: 1, subscriptions: 1, credits: 1 };

type Said = {
  readonly _tag: string;
  readonly request?: number;
  readonly body?: { readonly _tag: string; readonly source?: { readonly _tag: string } };
};
const messageOf = (frame: Recorded): Said | undefined => {
  const decoded = Schema.decodeUnknownSync(codecOf(frame.side))(frame.header) as {
    readonly body: 'bytes' | 'json';
    readonly message?: Said;
  };
  return decoded.body === 'bytes' ? decoded.message : (Schema.decodeUnknownSync(ClientMessageText)(chars.decode(payloadOf(frame))) as Said);
};

const said = (frames: ReadonlyArray<Recorded>) => frames.filter((each) => !isPreface(each.header)).map(messageOf);

describe('recorded wire corpus', () => {
  for (const [version, release] of releases) {
    const all = [...release.frames, ...release.arms];

    it(`reads every wire ${version} frame through the framing it was recorded in, byte for byte`, () => {
      const reader = frameReader(limits);
      for (const frame of all) {
        const read = reader.push(encodeFrame(text.encode(frame.header), payloadOf(frame)));
        if (read._tag === 'Fault') throw new Error(read.fault.detail);
        expect(read.frames.map((each) => [chars.decode(each.header), [...each.payload]])).toEqual([[frame.header, [...payloadOf(frame)]]]);
        for (const each of read.frames) each.release();
      }
    });

    if (version !== WIRE_VERSION) {
      it(`refuses wire ${version} frames at the current codec boundary`, () => {
        for (const frame of all.filter((each) => !isPreface(each.header))) {
          expect(() => Schema.decodeUnknownSync(codecOf(frame.side))(frame.header)).toThrow();
        }
      });
      continue;
    }

    it(`decodes every wire ${version} frame with the current codecs and re-encodes it unchanged`, () => {
      for (const frame of all.filter((each) => !isPreface(each.header))) {
        const codec = codecOf(frame.side);
        expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(frame.header))).toBe(frame.header);
      }
    });

    it(`ignores what a wire ${version} frame does not yet say: a field this side does not know, at any depth, changes nothing it reads`, () => {
      const widened = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(widened)
          : value !== null && typeof value === 'object'
            ? {
                ...Object.fromEntries(Object.entries(value).map(([key, each]) => [key, widened(each)])),
                unknownFutureField: { nested: [1] },
              }
            : value;
      for (const frame of all.filter((each) => !isPreface(each.header))) {
        const codec = codecOf(frame.side);
        const unknown = JSON.stringify(widened(JSON.parse(frame.header)));
        expect(Schema.decodeUnknownSync(codec)(unknown)).toEqual(Schema.decodeUnknownSync(codec)(frame.header));
      }
    });

    it(`answers every wire ${version} call exactly once, by its own request number`, () => {
      const called = said(release.frames.filter((frame) => frame.side === 'client'))
        .filter((message) => message?._tag === 'Call')
        .map((message) => message?.request);
      const answered = said(release.frames.filter((frame) => frame.side === 'host'))
        .filter((message) => message?.request !== undefined && (message._tag === 'Reply' || message._tag === 'Fault'))
        .map((message) => message?.request);
      expect(called.length).toBeGreaterThan(0);
      expect(answered.toSorted()).toEqual(called.toSorted());
    });
  }

  it('agrees on the current preface and answers no common wire for the historical release', () => {
    for (const [version, release] of releases) {
      expect(isPreface(release.frames[0]?.header ?? '')).toBe(true);
      const opening = clientOpening(release.frames[0]?.header ?? '');
      expect(opening._tag === 'Preface' ? opening.agreed : undefined).toBe(version === WIRE_VERSION ? version : undefined);
    }
  });

  it('carries the capability-gated request and event arms on the current wire', () => {
    const tagsOf = (frames: ReadonlyArray<Recorded>) => {
      const messages = said(frames);
      return {
        requests: new Set(messages.filter((each) => each?._tag === 'Call').map((each) => each?.body?._tag)),
        answers: new Set(messages.filter((each) => each?._tag === 'Reply').map((each) => each?.body?._tag)),
        events: new Set(messages.filter((each) => each?._tag === 'Event').map((each) => each?.body?._tag)),
        sources: new Set(messages.filter((each) => each?.body?._tag === 'Subscribe').map((each) => each?.body?.source?._tag)),
      };
    };
    const current = tagsOf([...corpus[WIRE_VERSION].frames, ...corpus[WIRE_VERSION].arms].filter((each) => !isPreface(each.header)));
    expect([...current.requests].toSorted()).toEqual(
      expect.arrayContaining(
        Object.keys(Request.cases).filter((tag) => capabilityOf(Request.cases[tag as keyof typeof Request.cases]) !== undefined),
      ),
    );
    expect([...current.events]).toContain('Load');
    expect([...current.sources]).toContain('Load');
  });
});

const ref = { installation: 'i', execution: 'e-1', incarnation: 1 };

const final: FinalFacts = Schema.decodeUnknownSync(FinalFacts)({
  execution: ref,
  nativeExit: { _tag: 'Code', code: 0 },
  sources: { stdout: { completed: true, offset: '12' }, stderr: { completed: true, offset: '0' } },
  cleanup: 'complete',
  retention: 'retained',
  confirmed: [],
  residual: [],
  unverifiable: [],
  streams: [],
  relation: 'leader',
  coverage: ['leader'],
  abandonedOutput: false,
});

describe('what a connection serves', () => {
  const call = (body: unknown): unknown => ({ _tag: 'Call', request: 7, installation: 'i', incarnation: 1, epoch: 1, body });
  const requestOf = (frame: Recorded): Request => (messageOf(frame) as unknown as { readonly body: Request }).body;

  it('refuses a request whose capability the connection does not serve, and names it', () => {
    const previous = servedOn(PREVIOUS_RELEASE.version, CAPABILITIES);
    const current = servedOn(WIRE_VERSION, CAPABILITIES);
    const limited = servedOn(WIRE_VERSION, announced(['machine-load', 'machine-load-parts', 'machine-load-gpu', 'machine-load-roles']));
    const recorded = [...corpus[WIRE_VERSION].frames, ...corpus[WIRE_VERSION].arms]
      .filter((frame) => frame.side === 'client' && !isPreface(frame.header) && messageOf(frame)?._tag === 'Call')
      .map(requestOf);
    const gated = recorded.filter((body) => requiredCapability(body) !== undefined);
    expect(gated.map((body) => body._tag).toSorted()).toEqual(expect.arrayContaining(['EndResidual', 'LoadInterest', 'Subscribe']));
    for (const body of gated) {
      const needed = requiredCapability(body);
      if (needed === undefined) continue;
      expect(unsupported(body, current)).toBeUndefined();
      if (needed === 'machine-load') expect(unsupported(body, limited)).toBeUndefined();
      else
        expect(unsupported(body, limited)).toEqual({
          _tag: 'UnsupportedCapability',
          capability: needed,
          reason: expect.stringContaining(needed),
        });
      if (needed !== 'machine-load' && PREVIOUS_RELEASE.serves.some((each) => each === needed))
        expect(unsupported(body, previous)).toBeUndefined();
      else
        expect(unsupported(body, previous)).toEqual({
          _tag: 'UnsupportedCapability',
          capability: needed,
          reason: expect.stringContaining(needed),
        });
    }
    expect(gated.some((body) => unsupported(body, limited) !== undefined)).toBe(true);
  });

  it('serves what the host announced and no name this build does not know, and nothing beyond the base to a host that announced nothing', () => {
    expect([...announced(['machine-load', 'teleport'])]).toEqual(['machine-load']);
    expect([...announced(undefined)]).toEqual([]);
    expect([...servedOn(PREVIOUS_RELEASE.version, CAPABILITIES)]).toEqual([...PREVIOUS_RELEASE.serves]);
    const welcome = corpus[WIRE_VERSION].frames.find((frame) => frame.side === 'host' && frame.header.includes('"Welcome"'));
    const message = JSON.parse(welcome?.header ?? '{}').message;
    const read = Schema.decodeUnknownSync(HostMessage)({ ...message, capabilities: [...CAPABILITIES, 'teleport'] }) as {
      readonly capabilities?: ReadonlyArray<string>;
    };
    expect([...announced(read.capabilities)].toSorted()).toEqual([...CAPABILITIES].toSorted());
  });

  it('refuses a call of a kind no version carries by its own request number, and passes a known one', () => {
    expect(unsupportedCall(call({ _tag: 'Teleport' }))).toEqual({
      request: 7 as never,
      refusal: expect.objectContaining({ _tag: 'UnsupportedCapability' }),
    });
    expect(unsupportedCall(call({ _tag: 'Status' }))).toBeUndefined();
    expect(unsupportedCall({ _tag: 'Cancel', request: 7 })).toBeUndefined();
  });

  it('keeps the incarnation of an explicit reference on every wire the range holds, for state and ending alike', () => {
    for (const version of [WIRE_VERSION]) {
      for (const body of [
        { _tag: 'State', execution: ref },
        { _tag: 'Ending', execution: ref },
      ]) {
        const message = { _tag: 'Call', request: 3, installation: 'i', incarnation: 2, epoch: 1, body };
        const read = Schema.decodeUnknownSync(client)(Schema.encodeSync(client)({ v: version, body: 'bytes', message } as never)) as {
          readonly message: { readonly body: { readonly execution: { readonly incarnation: number } } };
        };
        expect(read.message.body.execution.incarnation).toBe(ref.incarnation);
      }
    }
  });

  it('projects recorded final facts into an ending without inventing a measured cost', () => {
    const receipt = recordedEnding(final);
    expect(receipt.execution).toEqual(ref as never);
    expect(receipt.cleanup).toBe('complete');
    expect(receipt.cost._tag).toBe('Unmeasured');
    expect(receipt.unacquired).toBeUndefined();
    expect(Schema.decodeUnknownSync(EndingReceipt)(Schema.encodeSync(EndingReceipt)(receipt))).toEqual(receipt);
  });

  it('names the subscription of an event kind this side does not know, and nothing for a known one', () => {
    expect(unknownEvent({ _tag: 'Event', body: { _tag: 'Hologram', subscription: 3 } })).toBe(3 as never);
    expect(unknownEvent({ _tag: 'Event', body: { _tag: 'Ended', subscription: 3, ending: 'completed' } })).toBeUndefined();
    expect(unknownEvent({ _tag: 'Reply', request: 1, body: { _tag: 'Hologram' } })).toBeUndefined();
  });
});

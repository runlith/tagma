import { Result, Schema } from 'effect';
import { type ClientMessage, ClientMessage as ClientSchema, type HelperMessage, HelperMessage as HelperSchema } from './messages.ts';

export const FRAME_LIMIT = 1024 * 1024;
const CONTROL = 0;
const AUDIO = 1;
const HEAD = 5;

export type Frame =
  | { readonly kind: 'control'; readonly text: string }
  | { readonly kind: 'audio'; readonly body: Uint8Array }
  | { readonly kind: 'broken'; readonly detail: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const writeU32 = (out: Uint8Array, at: number, value: number): void => {
  out[at] = value & 0xff;
  out[at + 1] = (value >>> 8) & 0xff;
  out[at + 2] = (value >>> 16) & 0xff;
  out[at + 3] = (value >>> 24) & 0xff;
};

const readU32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

const writeI64 = (out: Uint8Array, at: number, value: bigint): void => {
  const word = BigInt.asUintN(64, value);
  writeU32(out, at, Number(word & 0xffff_ffffn));
  writeU32(out, at + 4, Number(word >> 32n));
};

const readI64 = (bytes: Uint8Array, at: number): bigint =>
  BigInt.asIntN(64, (BigInt(readU32(bytes, at + 4)) << 32n) | BigInt(readU32(bytes, at)));

const frame = (kind: number, size: number): Uint8Array => {
  const out = new Uint8Array(HEAD + size);
  writeU32(out, 0, 1 + size);
  out[4] = kind;
  return out;
};

const pcmBytes = (pcm: Int16Array): Uint8Array => new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);

export const controlFrame = (json: unknown): Uint8Array => {
  const body = encoder.encode(JSON.stringify(json));
  const out = frame(CONTROL, body.length);
  out.set(body, HEAD);
  return out;
};

export const encodeHelper = (message: HelperMessage): Uint8Array => controlFrame(Schema.encodeSync(HelperSchema)(message));

export const encodeClient = (message: ClientMessage): Uint8Array => controlFrame(Schema.encodeSync(ClientSchema)(message));

export const helperAudio = (id: number, at: bigint, pcm: Int16Array): Uint8Array => {
  const out = frame(AUDIO, 12 + pcm.byteLength);
  writeU32(out, HEAD, id);
  writeI64(out, HEAD + 4, at);
  out.set(pcmBytes(pcm), HEAD + 12);
  return out;
};

export const clientAudio = (id: number, pcm: Int16Array): Uint8Array => {
  const out = frame(AUDIO, 4 + pcm.byteLength);
  writeU32(out, HEAD, id);
  out.set(pcmBytes(pcm), HEAD + 4);
  return out;
};

export type HelperAudio = { readonly id: number; readonly at: bigint; readonly pcm: Int16Array };
export type ClientAudio = { readonly id: number; readonly pcm: Int16Array };

const samples = (bytes: Uint8Array): Int16Array | undefined => {
  if (bytes.length % 2 !== 0) return undefined;
  if (bytes.byteOffset % 2 === 0) return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  return new Int16Array(bytes.slice().buffer);
};

export const readHelperAudio = (body: Uint8Array): Result.Result<HelperAudio, string> => {
  if (body.length < 12) return Result.fail(`an audio frame of ${body.length} bytes has no id and time`);
  const pcm = samples(body.subarray(12));
  if (pcm === undefined) return Result.fail('an audio frame carries an odd number of PCM bytes');
  return Result.succeed({ id: readU32(body, 0), at: readI64(body, 4), pcm });
};

export const readClientAudio = (body: Uint8Array): Result.Result<ClientAudio, string> => {
  if (body.length < 4) return Result.fail(`an audio frame of ${body.length} bytes has no id`);
  const pcm = samples(body.subarray(4));
  if (pcm === undefined) return Result.fail('an audio frame carries an odd number of PCM bytes');
  return Result.succeed({ id: readU32(body, 0), pcm });
};

const strict = { onExcessProperty: 'error' } as const;
const decodeHelperSchema = Schema.decodeUnknownResult(HelperSchema, strict);
const decodeClientSchema = Schema.decodeUnknownResult(ClientSchema, strict);

const parsed = (text: string): Result.Result<unknown, string> => {
  try {
    return Result.succeed(JSON.parse(text));
  } catch (cause) {
    return Result.fail(`a control frame is not JSON: ${String(cause)}`);
  }
};

export class FrameReader {
  private buffer = new Uint8Array(64 * 1024);
  private start = 0;
  private end = 0;
  private broken = false;

  push(bytes: Uint8Array): ReadonlyArray<Frame> {
    if (this.broken) return [];
    this.append(bytes);
    const frames: Array<Frame> = [];
    while (this.end - this.start >= 4) {
      const length = readU32(this.buffer, this.start);
      if (length === 0 || length > FRAME_LIMIT) return this.fail(frames, `a frame of ${length} bytes is outside 1..${FRAME_LIMIT}`);
      if (this.end - this.start < 4 + length) break;
      const kind = this.buffer[this.start + 4];
      const body = this.buffer.slice(this.start + HEAD, this.start + 4 + length);
      this.start += 4 + length;
      if (kind === AUDIO) {
        frames.push({ kind: 'audio', body });
      } else if (kind === CONTROL) {
        const text = this.text(body);
        if (text === undefined) return this.fail(frames, 'a control frame is not UTF-8');
        frames.push({ kind: 'control', text });
      } else {
        return this.fail(frames, `a frame of unknown kind ${kind}`);
      }
    }
    return frames;
  }

  private text(body: Uint8Array): string | undefined {
    try {
      return decoder.decode(body);
    } catch {
      return undefined;
    }
  }

  private fail(frames: Array<Frame>, detail: string): ReadonlyArray<Frame> {
    this.broken = true;
    frames.push({ kind: 'broken', detail });
    return frames;
  }

  private append(bytes: Uint8Array): void {
    if (this.start > 0 && this.end + bytes.length > this.buffer.length) {
      this.buffer.copyWithin(0, this.start, this.end);
      this.end -= this.start;
      this.start = 0;
    }
    if (this.end + bytes.length > this.buffer.length) {
      let size = this.buffer.length;
      while (size < this.end + bytes.length) size *= 2;
      const grown = new Uint8Array(size);
      grown.set(this.buffer.subarray(0, this.end));
      this.buffer = grown;
    }
    this.buffer.set(bytes, this.end);
    this.end += bytes.length;
  }
}

export const readHelper = (text: string): Result.Result<HelperMessage, string> =>
  Result.flatMap(parsed(text), (json) => Result.mapError(decodeHelperSchema(json), (error) => error.message));

export const readClient = (text: string): Result.Result<ClientMessage, string> =>
  Result.flatMap(parsed(text), (json) => Result.mapError(decodeClientSchema(json), (error) => error.message));

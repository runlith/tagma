import type { HeldLaunch, HolderRefused, NextBundle, PaceAsk, PaceKept, TransportDescriptors } from '../holder/Holder';
import type { Pace } from '@runlith/executions/protocol/pace';
import type { NativeExit } from '@runlith/executions/protocol/execution';
import { STOP_STEPS, type StopStep } from '@runlith/executions/protocol/call';

export const MAX_FRAME = 4 << 20;

const LAUNCH = 1;
const ACT = 2;
const SIGNAL = 8;
const CLOSE_INPUT = 3;
const REAP = 4;
const RELEASE = 5;
const VACATE = 6;
const READY = 7;
const OBSERVE = 9;
const CLOSE_OUTPUT = 10;
const PACE = 11;
const BIND_GENERATION = 12;
const PREPARE = 13;
const ACTIVATE = 14;

const HELLO = 128;
const HELD = 129;
const LAUNCHED = 130;
const DONE = 131;
const REAPED = 132;
const REFUSED = 133;
const EXITED = 134;
const PACED = 135;

const PACE_CODES: ReadonlyArray<Pace> = ['full', 'low', 'lowest'];
const REASONS: ReadonlyArray<HolderRefused['reason']> = [
  'duplicate',
  'unknown',
  'reaped',
  'running',
  'transport',
  'os',
  'invalid',
  'unsupported',
  'capacity',
  'gone',
  'changed',
  'not-found',
  'denied',
  'timeout',
];
const INPUTS = ['absent', 'open', 'closed'] as const;

export type Usage = { readonly userMicros: number; readonly systemMicros: number; readonly peakRssBytes: number };

export type Row = {
  readonly id: string;
  readonly pid: number;
  readonly work: number;
  readonly terminal: string | undefined;
  readonly birth: string;
  readonly transport: 'pty' | 'pipes';
  readonly pace: Pace;
  readonly input: (typeof INPUTS)[number];
  readonly exit: NativeExit | undefined;
  readonly usage: Usage | undefined;
  readonly handleMask: number;
};

export type Message =
  | {
      readonly _tag: 'hello';
      readonly generation: number | undefined;
      readonly pid: number;
      readonly count: number;
      readonly handleLimit: number | 'absent';
      readonly expense: TransportDescriptors;
      readonly capabilities: ReadonlyArray<string>;
      readonly handed: ReadonlyArray<number>;
    }
  | { readonly _tag: 'held'; readonly record: Row; readonly handed: ReadonlyArray<number> }
  | { readonly _tag: 'launched'; readonly request: number; readonly record: Row; readonly handed: ReadonlyArray<number> }
  | { readonly _tag: 'done'; readonly request: number }
  | { readonly _tag: 'reaped'; readonly request: number; readonly exit: NativeExit; readonly usage: Usage }
  | { readonly _tag: 'refused'; readonly request: number; readonly reason: HolderRefused['reason']; readonly detail: string }
  | { readonly _tag: 'paced'; readonly request: number; readonly kept: ReadonlyArray<PaceKept> }
  | { readonly _tag: 'exited'; readonly id: string; readonly exit: NativeExit };

export const carried = (message: Message): number => {
  if (message._tag === 'hello') return 1;
  if (message._tag !== 'held' && message._tag !== 'launched') return 0;
  const mask = message.record.handleMask;
  return message.record.transport === 'pty' ? mask : (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
};

export const handedOf = (message: Message): ReadonlyArray<number> =>
  message._tag === 'hello' || message._tag === 'held' || message._tag === 'launched' ? message.handed : [];

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class Writer {
  private readonly parts: Array<Uint8Array> = [];
  private size = 0;

  constructor(op: number, request: number) {
    this.push(new Uint8Array(4));
    this.byte(op).word(request);
  }

  private push(part: Uint8Array): this {
    this.parts.push(part);
    this.size += part.length;
    return this;
  }

  byte(value: number): this {
    return this.push(Uint8Array.of(value));
  }

  half(value: number): this {
    const part = new Uint8Array(2);
    new DataView(part.buffer).setUint16(0, value, true);
    return this.push(part);
  }

  word(value: number): this {
    const part = new Uint8Array(4);
    new DataView(part.buffer).setUint32(0, value >>> 0, true);
    return this.push(part);
  }

  long(value: number): this {
    const part = new Uint8Array(8);
    new DataView(part.buffer).setBigUint64(0, BigInt(value), true);
    return this.push(part);
  }

  text(value: string): this {
    const bytes = encoder.encode(value);
    return this.word(bytes.length).push(bytes);
  }

  texts(values: ReadonlyArray<string>): this {
    this.word(values.length);
    for (const value of values) this.text(value);
    return this;
  }

  finish(): Uint8Array {
    const frame = new Uint8Array(this.size);
    let at = 0;
    for (const part of this.parts) {
      frame.set(part, at);
      at += part.length;
    }
    new DataView(frame.buffer).setUint32(0, this.size - 4, true);
    return frame;
  }
}

export class FrameMalformed extends Error {}

class Reader {
  private at = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(count: number): number {
    const at = this.at;
    if (at + count > this.bytes.length) throw new FrameMalformed('the frame ends inside a field');
    this.at += count;
    return at;
  }

  byte(): number {
    return this.view.getUint8(this.need(1));
  }

  word(): number {
    return this.view.getUint32(this.need(4), true);
  }

  signed(): number {
    return this.view.getInt32(this.need(4), true);
  }

  long(): number {
    return Number(this.view.getBigUint64(this.need(8), true));
  }

  text(): string {
    const length = this.word();
    const at = this.need(length);
    return decoder.decode(this.bytes.subarray(at, at + length));
  }

  texts(): ReadonlyArray<string> {
    const count = this.word();
    if (count > this.bytes.length) throw new FrameMalformed('a list claims more entries than the frame holds');
    return Array.from({ length: count }, () => this.text());
  }

  handed(): ReadonlyArray<number> {
    const count = this.word();
    if (count * 8 > this.bytes.length) throw new FrameMalformed('a frame names more handles than it holds');
    return Array.from({ length: count }, () => this.long());
  }

  exit(): NativeExit | undefined {
    const kind = this.byte();
    if (kind === 0) return undefined;
    if (kind === 1) return { _tag: 'Code', code: this.signed() };
    if (kind === 2) return { _tag: 'Signal', signal: this.text() };
    throw new FrameMalformed(`exit kind ${kind} is not one the holder writes`);
  }

  usage(): Usage {
    return { userMicros: this.long(), systemMicros: this.long(), peakRssBytes: this.long() };
  }

  record(): Row {
    const id = this.text();
    const pid = this.word();
    const work = this.word();
    const terminal = this.text();
    const birth = this.text();
    const transport = this.byte();
    const pace = PACE_CODES[this.byte()];
    const input = INPUTS[this.byte()];
    const exit = this.exit();
    const usage = this.byte() === 1 ? this.usage() : undefined;
    const handleMask = this.byte();
    if (
      (transport !== 1 && transport !== 2) ||
      pace === undefined ||
      input === undefined ||
      birth === '' ||
      (transport === 2 && handleMask > 7) ||
      (input === 'open') !== (transport === 1 ? handleMask > 0 : (handleMask & 4) !== 0)
    ) {
      throw new FrameMalformed(`the record of ${id} names a transport, pace, input, birth or handle set the holder never writes`);
    }
    return {
      id,
      pid,
      work,
      terminal: terminal === '' ? undefined : terminal,
      birth,
      transport: transport === 1 ? 'pty' : 'pipes',
      pace,
      input,
      exit,
      usage,
      handleMask,
    };
  }

  end(): void {
    if (this.at !== this.bytes.length) throw new FrameMalformed('the frame carries bytes past its fields');
  }
}

export const decode = (body: Uint8Array): Message => {
  const reader = new Reader(body);
  const op = reader.byte();
  const request = reader.word();
  const message = ((): Message => {
    switch (op) {
      case HELLO: {
        const pid = reader.word();
        const count = reader.word();
        const handleLimit = reader.byte() === 1 ? reader.long() : 'absent';
        const expense = { pty: reader.byte(), pipes: reader.byte() };
        const capabilities = reader.texts();
        const handed = reader.handed();
        const marker = reader.byte();
        if (marker !== 0 && marker !== 1) throw new FrameMalformed('the generation marker is neither absent nor present');
        const generation = marker === 1 ? reader.long() : undefined;
        if (generation !== undefined && !Number.isSafeInteger(generation))
          throw new FrameMalformed('the generation exceeds the wire integer');
        return { _tag: 'hello', pid, count, handleLimit, expense, capabilities, handed, generation };
      }
      case HELD:
        return { _tag: 'held', record: reader.record(), handed: reader.handed() };
      case LAUNCHED:
        return { _tag: 'launched', request, record: reader.record(), handed: reader.handed() };
      case DONE:
        return { _tag: 'done', request };
      case REAPED: {
        const exit = reader.exit();
        if (exit === undefined) throw new FrameMalformed('a reap answered no exit');
        return { _tag: 'reaped', request, exit, usage: reader.usage() };
      }
      case REFUSED: {
        const reason = REASONS[reader.byte() - 1];
        if (reason === undefined) throw new FrameMalformed('a refusal names no reason the holder writes');
        return { _tag: 'refused', request, reason, detail: reader.text() };
      }
      case PACED: {
        const count = reader.word();
        if (count > body.length) throw new FrameMalformed('a pace answer claims more processes than the frame holds');
        const kept = Array.from({ length: count }, (): PaceKept => {
          const kind = reader.byte();
          if (kind === 0) return { _tag: 'held' };
          if (kind === 1) return { _tag: 'moved' };
          if (kind !== 2) throw new FrameMalformed(`pace outcome ${kind} is not one the holder writes`);
          const reason = REASONS[reader.byte() - 1];
          if (reason === undefined) throw new FrameMalformed('a pace refusal names no reason the holder writes');
          return { _tag: 'refused', reason, detail: reader.text() };
        });
        return { _tag: 'paced', request, kept };
      }
      case EXITED: {
        const id = reader.text();
        const exit = reader.exit();
        if (exit === undefined) throw new FrameMalformed(`the exit of ${id} names no status`);
        return { _tag: 'exited', id, exit };
      }
      default:
        throw new FrameMalformed(`operation ${op} is not one the holder writes`);
    }
  })();
  reader.end();
  return message;
};

export const launch = (request: number, spec: HeldLaunch): Uint8Array => {
  const writer = new Writer(LAUNCH, request)
    .text(spec.id)
    .text(spec.path)
    .texts(spec.argv)
    .texts(spec.env.map(({ name, value }) => `${name}=${value}`));
  if (spec.cwd === undefined) writer.byte(0);
  else writer.byte(1).text(spec.cwd);
  if (spec.transport._tag === 'pty') writer.byte(1).half(spec.transport.geometry.rows).half(spec.transport.geometry.columns);
  else writer.byte(2).byte(spec.transport.stdin === 'ignore' ? 0 : spec.transport.stdin === 'inherit' ? 1 : 2);
  return writer.byte(PACE_CODES.indexOf(spec.pace)).finish();
};

export const act = (request: number, id: string, work: boolean, step: StopStep): Uint8Array =>
  new Writer(ACT, request)
    .text(id)
    .byte(work ? 2 : 1)
    .byte(STOP_STEPS.indexOf(step))
    .finish();

export const signal = (request: number, id: string, work: boolean, name: string): Uint8Array =>
  new Writer(SIGNAL, request)
    .text(id)
    .byte(work ? 2 : 1)
    .text(name)
    .finish();

export const closeInput = (request: number, id: string): Uint8Array => new Writer(CLOSE_INPUT, request).text(id).finish();
export const closeOutput = (request: number, id: string, stream: 'stdout' | 'stderr'): Uint8Array =>
  new Writer(CLOSE_OUTPUT, request)
    .text(id)
    .byte(stream === 'stdout' ? 1 : 2)
    .finish();
export const observe = (request: number, id: string): Uint8Array => new Writer(OBSERVE, request).text(id).finish();

export const reap = (request: number, id: string): Uint8Array => new Writer(REAP, request).text(id).finish();

export const release = (request: number, id: string): Uint8Array => new Writer(RELEASE, request).text(id).finish();

export const pace = (request: number, processes: ReadonlyArray<PaceAsk>): Uint8Array => {
  const writer = new Writer(PACE, request).word(processes.length);
  for (const { witness, initial, next } of processes) {
    writer.word(witness.pid).text(witness.birth).byte(PACE_CODES.indexOf(initial)).byte(PACE_CODES.indexOf(next));
  }
  return writer.finish();
};

export const vacate = (request: number): Uint8Array => new Writer(VACATE, request).finish();
export const ready = (request: number): Uint8Array => new Writer(READY, request).finish();
export const bindGeneration = (request: number, generation: number): Uint8Array =>
  new Writer(BIND_GENERATION, request).long(generation).finish();
export const prepare = (request: number, next: NextBundle): Uint8Array =>
  new Writer(PREPARE, request).text(next.holder).texts(next.logic).finish();
export const activate = (request: number): Uint8Array => new Writer(ACTIVATE, request).finish();

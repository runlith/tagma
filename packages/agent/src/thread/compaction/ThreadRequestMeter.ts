import { Effect } from 'effect';
import { type Sha256, sha256, sha256Batch } from '@runlith/utils/sha256';
import type { Message, ToolDefinition } from '@runlith/llm/schema/messages';
import type { ProjectionBasis } from '../../agent/AgentContext';
import type { AgentRequestFootprint } from '../../agent/AgentCallMeasurement';
import { discoveredToolNames } from '../../agent/AgentDeferredTools';
import { threadCall, type ThreadCallBroke } from '../ThreadBorder';
import { estimateImageFreeTokens, estimateThreadTokens, type ThreadMeasuredRequest, type ThreadTokenEstimate } from './measurement';

type MeteredPiece = {
  readonly imageTokens: number;
  readonly tokens: number;
  readonly digest: string;
};

export type MeteredRequest = {
  readonly tokens: number;
  readonly footprint: AgentRequestFootprint;
};

export type MeteredRequestInput = {
  readonly system: string | undefined;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly providerOptions: unknown;
};

type MessagePrefix = {
  readonly message: Message;
  readonly tokens: number;
  readonly safeTokens: boolean;
  readonly digest: string;
};

type ChainedPrefix = { at: number; readonly running: Sha256; hex: string };

const unchained = (): ChainedPrefix => ({ at: 0, running: sha256(), hex: combine([]) });

type MeteredEnvelope = {
  readonly tokens: number;
  readonly prompt: number;
  readonly promptDigest: string;
  readonly tools: readonly MeteredPiece[];
};

export type MessageMeasure = { readonly digest: string; readonly tokens: number | null };

const measuredMessages = new WeakMap<Message, MessageMeasure>();

export function recallMessageMeasure(message: Message, measure: MessageMeasure): void {
  measuredMessages.set(message, measure);
}

export const measureMessages = (messages: readonly Message[]): Effect.Effect<readonly MessageMeasure[], ThreadCallBroke> =>
  Effect.suspend(() => {
    const fresh = [...new Set(messages.filter((message) => !measuredMessages.has(message)))];
    const values = fresh.flatMap((message): unknown[] => [{ ...message, content: [] }, ...message.content]);
    return Effect.forEach(values, (value) => digestBytes(value)).pipe(
      Effect.flatMap((bytes) => threadCall(() => sha256Batch(bytes))),
      Effect.flatMap((digests) => {
        if (digests.length !== values.length) return Effect.die(new Error('SHA-256 batch did not answer every message piece'));
        let at = 0;
        for (const message of fresh) {
          const pieces = values.slice(at, at + message.content.length + 1);
          let tokens: number | null = 0;
          for (const piece of pieces) {
            const price: number | null = tokens === null ? null : estimateImageFreeTokens(piece);
            tokens = tokens === null || price === null ? null : tokens + price;
          }
          measuredMessages.set(message, { digest: combine(digests.slice(at, at + pieces.length)), tokens });
          at += pieces.length;
        }
        return Effect.succeed(messages.map((message) => measuredMessages.get(message)!));
      }),
    );
  });

export class MeteredParts {
  readonly pieces = new WeakMap<object, MeteredPiece>();
  readonly messages = new WeakMap<Message, MeteredPiece>();
  readonly prices = new WeakMap<object, { readonly imageTokens: number; readonly tokens: number }>();
  readonly messagePrices = new WeakMap<Message, { readonly imageTokens: number; readonly tokens: number }>();
}

export class ThreadRequestMeter {
  private readonly pieces: MeteredParts['pieces'];
  private readonly messages: MeteredParts['messages'];
  private readonly prices: MeteredParts['prices'];
  private readonly messagePrices: MeteredParts['messagePrices'];
  private readonly prefix: MessagePrefix[] = [];
  private prefixImageTokens: number | undefined;
  private chained = unchained();
  private revealed = new Set<string>();
  private revealedOver: readonly Message[] = [];
  private lastSystem: { readonly value: string | undefined; readonly piece: MeteredPiece } | undefined;
  private lastOptions: { readonly value: unknown; readonly piece: MeteredPiece } | undefined;

  constructor(parts: MeteredParts = new MeteredParts()) {
    this.pieces = parts.pieces;
    this.messages = parts.messages;
    this.prices = parts.prices;
    this.messagePrices = parts.messagePrices;
  }

  requestHashed(input: MeteredRequestInput, imageTokens: number): Effect.Effect<MeteredRequest, ThreadCallBroke> {
    return Effect.map(this.prepare(input, imageTokens), (fixed) => {
      this.lastSystem = { value: input.system, piece: fixed.system };
      this.lastOptions = { value: input.providerOptions, piece: fixed.options };
      return this.request(input, imageTokens);
    });
  }

  estimateHashed(
    input: MeteredRequestInput,
    basis: ThreadMeasuredRequest | null,
    imageTokens: number,
  ): Effect.Effect<ThreadTokenEstimate & { readonly basis: ProjectionBasis }, ThreadCallBroke> {
    return Effect.map(this.prepare(input, imageTokens), (fixed) => {
      this.lastSystem = { value: input.system, piece: fixed.system };
      this.lastOptions = { value: input.providerOptions, piece: fixed.options };
      return this.estimate(input, basis, imageTokens);
    });
  }

  size(input: MeteredRequestInput, imageTokens: number): number {
    let tokens = estimateThreadTokens(input.system, imageTokens) + this.valueTokens(input.providerOptions, imageTokens);
    const revealed = input.tools.some((tool) => tool.deferred) ? discoveredToolNames(input.messages) : undefined;
    for (const tool of input.tools) {
      tokens +=
        tool.deferred === true && revealed !== undefined && !revealed.has(tool.name)
          ? estimateThreadTokens(tool.name, imageTokens)
          : this.valueTokens(tool, imageTokens);
    }
    for (const message of input.messages) tokens += this.messageTokens(message, imageTokens);
    return tokens;
  }

  request(input: MeteredRequestInput, imageTokens: number): MeteredRequest {
    const envelope = this.envelope(input, imageTokens);
    const prefix = this.messagePrefix(input.messages, imageTokens);
    const combined = envelope.tokens + (prefix?.tokens ?? 0);
    const tokens =
      (prefix?.safeTokens ?? true) && Number.isSafeInteger(envelope.tokens) && Number.isSafeInteger(combined)
        ? combined
        : input.messages.reduce((sum, message) => sum + this.messageTokens(message, imageTokens), envelope.tokens);
    return {
      tokens,
      footprint: {
        messages: input.messages.length,
        messageDigest: this.digestAt(this.prefix.length),
        promptDigest: envelope.promptDigest,
        toolDigests: envelope.tools.map((tool) => tool.digest),
      },
    };
  }

  estimate(
    input: MeteredRequestInput,
    basis: ThreadMeasuredRequest | null,
    imageTokens: number,
  ): ThreadTokenEstimate & { readonly basis: ProjectionBasis } {
    const envelope = this.envelope(input, imageTokens);
    const opened = basis === null ? 'none' : this.opensOn(input, basis, imageTokens);
    if (opened !== 'measured' || basis === null) {
      return { measured: 0, covered: 0, estimated: this.request(input, imageTokens).tokens, basis: opened };
    }
    const prompted = envelope.promptDigest === basis.footprint.promptDigest;
    let covered = envelope.prompt;
    let estimated = prompted ? 0 : envelope.prompt;
    const counted = new Set(basis.footprint.toolDigests);
    for (const tool of envelope.tools) {
      if (counted.has(tool.digest)) covered += tool.tokens;
      else estimated += tool.tokens;
    }
    const kept = basis.footprint.messages;
    if ((this.prefix.at(-1)?.safeTokens ?? true) && Number.isInteger(kept) && kept >= 0) {
      const head = this.prefix[kept - 1]?.tokens ?? 0;
      covered += head;
      estimated += (this.prefix.at(-1)?.tokens ?? 0) - head;
    } else {
      for (const message of input.messages.slice(0, kept)) covered += this.messageTokens(message, imageTokens);
      for (const message of input.messages.slice(kept)) estimated += this.messageTokens(message, imageTokens);
    }
    const sent = new Set(envelope.tools.map((tool) => tool.digest));
    const whole = basis.footprint.toolDigests.every((digest) => sent.has(digest));
    return { measured: basis.inputTokens, covered, estimated, basis: !prompted ? 'prompt' : whole ? 'measured' : 'tools' };
  }

  private prepare(
    input: MeteredRequestInput,
    imageTokens: number,
  ): Effect.Effect<{ readonly system: MeteredPiece; readonly options: MeteredPiece }, ThreadCallBroke> {
    return Effect.suspend(() => this.prepared(input, imageTokens));
  }

  private prepared(
    input: MeteredRequestInput,
    imageTokens: number,
  ): Effect.Effect<{ readonly system: MeteredPiece; readonly options: MeteredPiece }, ThreadCallBroke> {
    const jobs: { imageTokens: number; tokens: number; digest: string; readonly value: unknown }[] = [];
    const pending = new Map<unknown, MeteredPiece>();
    const queue = (value: unknown): MeteredPiece => {
      const held = typeof value === 'object' && value !== null ? this.pieces.get(value) : undefined;
      if (held !== undefined) {
        return { imageTokens, tokens: this.valueTokens(value, imageTokens), digest: held.digest };
      }
      const waiting = pending.get(value);
      if (waiting !== undefined) return waiting;
      const job = { imageTokens, tokens: this.valueTokens(value, imageTokens), digest: '', value };
      jobs.push(job);
      pending.set(value, job);
      return job;
    };
    const fixed = <T>(held: { readonly value: T; readonly piece: MeteredPiece } | undefined, value: T): MeteredPiece =>
      held !== undefined && held.value === value
        ? { imageTokens, tokens: this.valueTokens(value, imageTokens), digest: held.piece.digest }
        : queue(value);
    const system = fixed(this.lastSystem, input.system);
    const options = fixed(this.lastOptions, input.providerOptions);
    for (const tool of input.tools) queue(tool);
    const messages: { readonly message: Message; readonly shell: MeteredPiece; readonly parts: readonly MeteredPiece[] }[] = [];
    for (let at = this.shared(input.messages, imageTokens); at < input.messages.length; at += 1) {
      const message = input.messages[at]!;
      const held = this.messages.get(message);
      if (held?.imageTokens === imageTokens) continue;
      const digest = held?.digest ?? measuredMessages.get(message)?.digest;
      if (digest !== undefined) {
        this.messages.set(message, { imageTokens, tokens: this.messageTokens(message, imageTokens), digest });
        continue;
      }
      messages.push({ message, shell: queue({ ...message, content: [] }), parts: message.content.map((part) => queue(part)) });
    }
    return Effect.forEach(jobs, (job) => digestBytes(job.value)).pipe(
      Effect.flatMap((bytes) => threadCall(() => sha256Batch(bytes))),
      Effect.flatMap((digests) => {
        if (digests.length !== jobs.length) return Effect.die(new Error('SHA-256 batch did not answer every request piece'));
        for (let at = 0; at < jobs.length; at += 1) jobs[at]!.digest = digests[at]!;
        for (const [value, piece] of pending) {
          if (typeof value === 'object' && value !== null)
            this.pieces.set(value, { imageTokens, tokens: piece.tokens, digest: piece.digest });
        }
        for (const held of messages) {
          const tokens = held.shell.tokens + held.parts.reduce((sum, part) => sum + part.tokens, 0);
          this.messagePrices.set(held.message, { imageTokens, tokens });
          this.messages.set(held.message, {
            imageTokens,
            tokens,
            digest: combine([held.shell.digest, ...held.parts.map((part) => part.digest)]),
          });
        }
        const priced = ({ tokens, digest }: MeteredPiece): MeteredPiece => ({ imageTokens, tokens, digest });
        return Effect.succeed({ system: priced(system), options: priced(options) });
      }),
    );
  }

  private valueTokens(value: unknown, imageTokens: number): number {
    if (typeof value !== 'object' || value === null) return estimateThreadTokens(value, imageTokens);
    const held = this.prices.get(value);
    if (held?.imageTokens === imageTokens) return held.tokens;
    const tokens = estimateThreadTokens(value, imageTokens);
    this.prices.set(value, { imageTokens, tokens });
    return tokens;
  }

  private messageTokens(message: Message, imageTokens: number): number {
    const held = this.messagePrices.get(message);
    if (held?.imageTokens === imageTokens) return held.tokens;
    let tokens = measuredMessages.get(message)?.tokens ?? null;
    if (tokens === null) {
      tokens = estimateThreadTokens({ ...message, content: [] }, imageTokens);
      for (const part of message.content) tokens += this.valueTokens(part, imageTokens);
    }
    this.messagePrices.set(message, { imageTokens, tokens });
    return tokens;
  }

  private opensOn(input: MeteredRequestInput, basis: ThreadMeasuredRequest, imageTokens: number): 'measured' | 'length' | 'prefix' {
    const covered = basis.footprint.messages;
    if (covered > input.messages.length) return 'length';
    this.messagePrefix(input.messages, imageTokens);
    const end = Number.isInteger(covered) && covered >= 0 ? covered : input.messages.slice(0, covered).length;
    return this.digestAt(end) === basis.footprint.messageDigest ? 'measured' : 'prefix';
  }

  private envelope(input: MeteredRequestInput, imageTokens: number): MeteredEnvelope {
    const system = this.fixed(this.lastSystem, input.system, imageTokens, (held) => {
      this.lastSystem = held;
    });
    const options = this.fixed(this.lastOptions, input.providerOptions, imageTokens, (held) => {
      this.lastOptions = held;
    });
    const prompt = system.tokens + options.tokens;
    let tokens = prompt;
    const tools: MeteredPiece[] = [];
    const revealed = input.tools.some((tool) => tool.deferred) ? this.revealedIn(input.messages) : undefined;
    for (const tool of input.tools) {
      const priced = this.piece(tool, imageTokens);
      const offered =
        tool.deferred === true && revealed !== undefined && !revealed.has(tool.name)
          ? { imageTokens, tokens: estimateThreadTokens(tool.name, imageTokens), digest: combine(['deferred', tool.name]) }
          : priced;
      tokens += offered.tokens;
      tools.push(offered);
    }
    return {
      tokens,
      prompt,
      promptDigest: combine([system.digest, options.digest]),
      tools,
    };
  }

  private fixed<T>(
    held: { readonly value: T; readonly piece: MeteredPiece } | undefined,
    value: T,
    imageTokens: number,
    keep: (held: { readonly value: T; readonly piece: MeteredPiece }) => void,
  ): MeteredPiece {
    if (held !== undefined && held.value === value && held.piece.imageTokens === imageTokens) return held.piece;
    const piece = {
      imageTokens,
      tokens: this.valueTokens(value, imageTokens),
      digest: held !== undefined && held.value === value ? held.piece.digest : digestOf(value),
    };
    keep({ value, piece });
    return piece;
  }

  prefixDigest(messages: readonly Message[], count: number, imageTokens: number): string | null {
    if (!Number.isInteger(count) || count < 0 || count > messages.length) return null;
    if (count <= this.shared(messages, imageTokens)) return this.digestAt(count);
    const digests: string[] = [];
    for (let at = 0; at < count; at += 1) digests.push(this.message(messages[at]!, imageTokens).digest);
    return combine(digests);
  }

  private digestAt(count: number): string {
    const chained = this.chained;
    if (count === chained.at) return chained.hex;
    if (count < chained.at) return combine(this.prefix.slice(0, count).map((entry) => entry.digest));
    chained.running.update(
      this.prefix
        .slice(chained.at, count)
        .map((entry) => entry.digest)
        .join(''),
    );
    chained.at = count;
    chained.hex = chained.running.copy().digest('hex');
    return chained.hex;
  }

  private shared(messages: readonly Message[], imageTokens: number): number {
    if (this.prefixImageTokens !== imageTokens) return 0;
    let shared = 0;
    while (shared < this.prefix.length && shared < messages.length && this.prefix[shared]!.message === messages[shared]) shared += 1;
    return shared;
  }

  private revealedIn(messages: readonly Message[]): ReadonlySet<string> {
    const known = this.revealedOver;
    if (messages === known) return this.revealed;
    let shared = 0;
    while (shared < known.length && shared < messages.length && known[shared] === messages[shared]) shared += 1;
    if (shared < known.length) {
      this.revealed = new Set();
      shared = 0;
    }
    for (const name of discoveredToolNames(messages.slice(shared))) this.revealed.add(name);
    this.revealedOver = messages;
    return this.revealed;
  }

  private messagePrefix(messages: readonly Message[], imageTokens: number): MessagePrefix | undefined {
    const shared = this.shared(messages, imageTokens);
    if (this.prefixImageTokens !== imageTokens) this.prefixImageTokens = imageTokens;
    this.prefix.length = shared;
    if (shared < this.chained.at) this.chained = unchained();
    let last = this.prefix.at(-1);
    for (let at = shared; at < messages.length; at += 1) {
      const message = messages[at]!;
      const piece = this.message(message, imageTokens);
      const tokens = (last?.tokens ?? 0) + piece.tokens;
      const safeTokens = (last?.safeTokens ?? true) && Number.isSafeInteger(piece.tokens) && Number.isSafeInteger(tokens);
      last = { message, tokens, safeTokens, digest: piece.digest };
      this.prefix.push(last);
    }
    return last;
  }

  private message(message: Message, imageTokens: number): MeteredPiece {
    const held = this.messages.get(message);
    if (held?.imageTokens === imageTokens) return held;
    const tokens = this.messageTokens(message, imageTokens);
    const digest =
      held?.digest ??
      measuredMessages.get(message)?.digest ??
      combine([digestOf({ ...message, content: [] }), ...message.content.map((part) => this.piece(part, imageTokens).digest)]);
    const priced = { imageTokens, tokens, digest };
    this.messages.set(message, priced);
    return priced;
  }

  private piece(value: object, imageTokens: number): MeteredPiece {
    const held = this.pieces.get(value);
    if (held?.imageTokens === imageTokens) return held;
    const priced = { imageTokens, tokens: this.valueTokens(value, imageTokens), digest: held?.digest ?? digestOf(value) };
    this.pieces.set(value, priced);
    return priced;
  }
}

const encoder = new TextEncoder();
const SLICE_BYTES = 65_536;

const digestBytes = Effect.fnUntraced(function* (value: unknown) {
  let bytes = new Uint8Array(1024);
  let length = 0;
  let sliced = 0;
  for (const data of absorb(value)) {
    const needed = length + (typeof data === 'string' ? data.length : data.byteLength);
    if (needed > bytes.length) {
      const grown = new Uint8Array(Math.max(needed, bytes.length * 2));
      grown.set(bytes);
      bytes = grown;
    }
    if (typeof data !== 'string') bytes.set(data, length);
    else if (data.length === 1) bytes[length] = data.charCodeAt(0);
    else encoder.encodeInto(data, bytes.subarray(length));
    length = needed;
    if (length - sliced >= SLICE_BYTES) {
      sliced = length;
      yield* Effect.yieldNow;
    }
  }
  return bytes.subarray(0, length);
});

function digestOf(value: unknown): string {
  const running = sha256();
  for (const part of absorb(value)) running.update(part);
  return running.digest('hex');
}

function* absorb(value: unknown): Generator<string | Uint8Array> {
  const bytes = binaryOf(value);
  if (bytes !== null) {
    yield 'b';
    yield size(bytes.byteLength);
    yield bytes;
    return;
  }
  if (value === null) {
    yield 'z';
    return;
  }
  if (Array.isArray(value)) {
    yield 'a';
    yield size(value.length);
    for (const item of value) yield* absorb(item === undefined ? null : item);
    return;
  }
  switch (typeof value) {
    case 'string':
      yield 's';
      yield* textParts(value);
      return;
    case 'number':
    case 'bigint':
      yield 'n';
      yield String(value);
      yield '\u0000';
      return;
    case 'boolean':
      yield value ? 't' : 'f';
      return;
    case 'undefined':
      yield 'u';
      return;
    case 'object': {
      yield 'o';
      const entries = Object.entries(value).filter(([, item]) => item !== undefined);
      yield size(entries.length);
      for (const [key, item] of entries) {
        yield* textParts(key);
        yield* absorb(item);
      }
      return;
    }
    default:
      yield 'x';
  }
}

const ASCII = /^[\x00-\x7f]*$/;

function* textParts(text: string): Generator<string | Uint8Array> {
  if (ASCII.test(text)) {
    yield size(text.length);
    yield text;
    return;
  }
  const bytes = encoder.encode(text);
  yield size(bytes.byteLength);
  yield bytes;
}

function size(length: number): Uint8Array {
  const width = new Uint8Array(4);
  const value = length >>> 0;
  width[0] = value >>> 24;
  width[1] = (value >>> 16) & 0xff;
  width[2] = (value >>> 8) & 0xff;
  width[3] = value & 0xff;
  return width;
}

function binaryOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
}

function combine(digests: readonly string[]): string {
  const running = sha256();
  running.update(digests.join(''));
  return running.digest('hex');
}

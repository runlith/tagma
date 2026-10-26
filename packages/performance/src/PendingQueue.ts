import type { PerformanceRecordKind } from './protocol/records.js';

const encoder = new TextEncoder();

const OPEN = 0x5b;
const SEPARATOR = 0x2c;
const CLOSE = 0x5d;

const INITIAL_BYTES = 8 * 1024;

export type PendingClass = 'span' | 'rest';

export const pendingClass = (kind: PerformanceRecordKind): PendingClass => (kind === 'span' ? 'span' : 'rest');

export class PendingBuffer {
  state: 'open' | 'sealed' | 'inflight' = 'open';
  records = 0;
  readonly kinds = new Map<PerformanceRecordKind, number>();
  readonly groups = new Set<string>();
  prev: PendingBuffer | null = null;
  next: PendingBuffer | null = null;
  linked = false;
  private store = new ArrayBuffer(INITIAL_BYTES);
  private text = new Uint8Array(this.store);
  private length = 1;

  constructor(
    readonly sequence: number,
    readonly held: PendingClass,
  ) {
    this.text[0] = OPEN;
  }

  get bytes(): number {
    return this.length + 1;
  }

  append(line: string, kind: PerformanceRecordKind, retentionKey: string): boolean {
    this.reserve(line.length * 3 + 2);
    if (this.records > 0) {
      this.text[this.length] = SEPARATOR;
      this.length += 1;
    }
    this.length += encoder.encodeInto(line, this.text.subarray(this.length)).written;
    this.records += 1;
    this.kinds.set(kind, (this.kinds.get(kind) ?? 0) + 1);
    if (this.groups.has(retentionKey)) return false;
    this.groups.add(retentionKey);
    return true;
  }

  take(): ArrayBuffer {
    this.text[this.length] = CLOSE;
    return this.store.transfer(this.length + 1);
  }

  private reserve(wanted: number): void {
    const needed = this.length + wanted;
    if (needed <= this.text.length) return;
    let capacity = this.text.length;
    while (capacity < needed) capacity *= 2;
    const store = new ArrayBuffer(capacity);
    const text = new Uint8Array(store);
    text.set(this.text.subarray(0, this.length));
    this.store = store;
    this.text = text;
  }
}

class BufferChain {
  head: PendingBuffer | null = null;
  tail: PendingBuffer | null = null;

  push(buffer: PendingBuffer): void {
    buffer.prev = this.tail;
    if (this.tail === null) this.head = buffer;
    else this.tail.next = buffer;
    this.tail = buffer;
    buffer.linked = true;
  }

  remove(buffer: PendingBuffer): void {
    if (buffer.prev === null) this.head = buffer.next;
    else buffer.prev.next = buffer.next;
    if (buffer.next === null) this.tail = buffer.prev;
    else buffer.next.prev = buffer.prev;
    buffer.prev = null;
    buffer.next = null;
    buffer.linked = false;
  }
}

export class PendingQueue {
  private readonly chains: Record<PendingClass, BufferChain> = { span: new BufferChain(), rest: new BufferChain() };
  private count = 0;
  private buffers = 0;
  private held = 0;
  private readonly holders = new Map<string, number>();
  private keys: ReadonlyArray<string> | null = null;

  get size(): number {
    return this.count;
  }

  get bytes(): number {
    return this.held;
  }

  get depth(): number {
    return this.buffers;
  }

  opened(held: PendingClass): PendingBuffer | undefined {
    const tail = this.chains[held].tail;
    return tail !== null && tail.state === 'open' ? tail : undefined;
  }

  push(buffer: PendingBuffer): PendingBuffer {
    this.chains[buffer.held].push(buffer);
    this.buffers += 1;
    this.held += buffer.bytes;
    return buffer;
  }

  append(buffer: PendingBuffer, line: string, kind: PerformanceRecordKind, retentionKey: string): void {
    this.held -= buffer.bytes;
    if (buffer.append(line, kind, retentionKey)) this.retain(retentionKey);
    this.held += buffer.bytes;
    this.count += 1;
  }

  seal(buffer: PendingBuffer): void {
    if (buffer.state === 'open') buffer.state = 'sealed';
  }

  nextSealed(): PendingBuffer | undefined {
    const span = sealed(this.chains.span);
    const rest = sealed(this.chains.rest);
    if (span === undefined) return rest;
    if (rest === undefined) return span;
    return span.sequence < rest.sequence ? span : rest;
  }

  post(buffer: PendingBuffer): void {
    buffer.state = 'inflight';
  }

  victim(newest: PendingBuffer | undefined): PendingBuffer | undefined {
    const older = eligible(this.chains.span, newest);
    if (older !== undefined) return older;
    if (newest !== undefined && newest.held === 'span' && newest.linked && newest.state !== 'inflight') return newest;
    return eligible(this.chains.rest, newest);
  }

  remove(buffer: PendingBuffer): void {
    if (!buffer.linked) return;
    this.chains[buffer.held].remove(buffer);
    this.buffers -= 1;
    this.count -= buffer.records;
    this.held -= buffer.bytes;
    for (const key of buffer.groups) this.release(key);
  }

  *[Symbol.iterator](): Generator<PendingBuffer> {
    for (const held of ['span', 'rest'] as const) {
      for (let buffer = this.chains[held].head; buffer !== null; buffer = buffer.next) yield buffer;
    }
  }

  clear(): void {
    for (const held of ['span', 'rest'] as const) {
      const chain = this.chains[held];
      for (let buffer = chain.head; buffer !== null;) {
        const next = buffer.next;
        buffer.prev = null;
        buffer.next = null;
        buffer.linked = false;
        buffer = next;
      }
      chain.head = null;
      chain.tail = null;
    }
    this.count = 0;
    this.buffers = 0;
    this.held = 0;
    this.holders.clear();
    this.keys = null;
  }

  retain(key: string): void {
    const holders = this.holders.get(key) ?? 0;
    this.holders.set(key, holders + 1);
    if (holders === 0) this.keys = null;
  }

  release(key: string): void {
    const holders = this.holders.get(key);
    if (holders === undefined) return;
    if (holders > 1) {
      this.holders.set(key, holders - 1);
      return;
    }
    this.holders.delete(key);
    this.keys = null;
  }

  holds(key: string): boolean {
    return this.holders.has(key);
  }

  get protectedKeys(): ReadonlyArray<string> {
    return (this.keys ??= [...this.holders.keys()]);
  }
}

const sealed = (chain: BufferChain): PendingBuffer | undefined => {
  for (let buffer = chain.head; buffer !== null; buffer = buffer.next) {
    if (buffer.state === 'sealed') return buffer;
  }
  return undefined;
};

const eligible = (chain: BufferChain, exclude: PendingBuffer | undefined): PendingBuffer | undefined => {
  for (let buffer = chain.head; buffer !== null; buffer = buffer.next) {
    if (buffer !== exclude && buffer.state !== 'inflight') return buffer;
  }
  return undefined;
};

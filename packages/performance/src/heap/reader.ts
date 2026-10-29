import * as Schema from 'effect/Schema';
import { closeSync, openSync, readSync } from 'node:fs';
import type { HeapClass, HeapSummary } from '../HeapSummary.js';

export class InvalidSnapshot extends Error {}

const integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const headerSchema = Schema.Struct({
  node_count: integer,
  meta: Schema.Struct({
    node_fields: Schema.Array(Schema.String),
    node_types: Schema.Array(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  }),
});

type Aggregate = { count: number; sizeBytes: number };
const nodeTypes = new Set([
  'hidden',
  'array',
  'string',
  'object',
  'code',
  'closure',
  'regexp',
  'number',
  'native',
  'synthetic',
  'concatenated string',
  'sliced string',
  'symbol',
  'bigint',
  'object shape',
]);

function invalid(): never {
  throw new InvalidSnapshot();
}

function add(table: Map<string, Aggregate>, name: string, row: Aggregate): void {
  const current = table.get(name);
  if (current === undefined) table.set(name, row);
  else {
    current.count += row.count;
    current.sizeBytes += row.sizeBytes;
    if (!Number.isSafeInteger(current.sizeBytes)) invalid();
  }
}

export function readSnapshot(file: string): HeapSummary {
  const descriptor = openSync(file, 'r');
  try {
    const input = new JsonInput(descriptor);
    let header: typeof headerSchema.Type | undefined;
    const named = new Map<number, Aggregate>();
    const classes = new Map<string, Aggregate>();
    const seen = new Set<string>();
    let objectCount = 0;
    let sizeBytes = 0;
    let detachedNodes = 0;
    let maxName = -1;
    input.object((key) => {
      if (key === 'snapshot') {
        if (seen.has(key) || seen.has('nodes')) invalid();
        const fields: Record<string, unknown> = {};
        input.object((field) => {
          if (field === 'node_count') {
            if (fields[field] !== undefined) invalid();
            fields[field] = input.uint();
          } else if (field === 'meta') {
            if (fields[field] !== undefined) invalid();
            const meta: Record<string, unknown> = {};
            input.object((name) => {
              if (name !== 'node_fields' && name !== 'node_types') return input.skip();
              if (meta[name] !== undefined) invalid();
              const values: Array<string | string[]> = [];
              input.array(() => {
                if (input.peekValue() !== 91) values.push(input.string());
                else {
                  const types: string[] = [];
                  input.array(() => {
                    types.push(input.string());
                  });
                  values.push(types);
                }
              });
              meta[name] = values;
            });
            fields[field] = meta;
          } else input.skip();
        });
        const decoded = Schema.decodeUnknownResult(headerSchema)(fields);
        if (decoded._tag === 'Failure') invalid();
        header = decoded.success;
        seen.add(key);
      } else if (key === 'nodes') {
        if (header === undefined || seen.has(key) || seen.has('strings')) invalid();
        const fields = header.meta.node_fields;
        if (new Set(fields).size !== fields.length) invalid();
        const typeOffset = fields.indexOf('type');
        const nameOffset = fields.indexOf('name');
        const sizeOffset = fields.indexOf('self_size');
        const detachedOffset = fields.indexOf('detachedness');
        if (typeOffset < 0 || nameOffset < 0 || sizeOffset < 0) invalid();
        const types = header.meta.node_types[typeOffset];
        if (typeof types === 'string' || types === undefined || types.some((type) => !nodeTypes.has(type))) invalid();
        let type = 0;
        let name = 0;
        let size = 0;
        let detachedness = 0;
        let entries = 0;
        input.array((index) => {
          const value = input.uint();
          const offset = index % fields.length;
          if (offset === typeOffset) type = value;
          if (offset === nameOffset) name = value;
          if (offset === sizeOffset) size = value;
          if (offset === detachedOffset) detachedness = value;
          entries += 1;
          if (offset !== fields.length - 1) return;
          const kind = types[type];
          if (kind === undefined || detachedness > 2) invalid();
          objectCount += 1;
          sizeBytes += size;
          if (!Number.isSafeInteger(sizeBytes)) invalid();
          maxName = Math.max(maxName, name);
          if (kind === 'native' && detachedness === 2) detachedNodes += 1;
          if (kind === 'object' || kind === 'native') {
            const row = named.get(name);
            if (row === undefined) named.set(name, { count: 1, sizeBytes: size });
            else {
              row.count += 1;
              row.sizeBytes += size;
            }
          } else add(classes, `(${kind})`, { count: 1, sizeBytes: size });
        });
        if (entries % fields.length !== 0 || objectCount !== header.node_count) invalid();
        seen.add(key);
      } else if (key === 'strings') {
        if (!seen.has('nodes') || seen.has(key)) invalid();
        let length = 0;
        input.array((index) => {
          const row = named.get(index);
          if (row === undefined) input.string(false);
          else {
            add(classes, input.string(), row);
            named.delete(index);
          }
          length += 1;
        });
        if (maxName >= length || named.size !== 0) invalid();
        seen.add(key);
      } else input.skip();
    });
    if (!seen.has('snapshot') || !seen.has('nodes') || !seen.has('strings') || input.peekValue() !== -1) invalid();
    const rows: HeapClass[] = [...classes].map(([name, row]) => ({ name, ...row }));
    rows.sort((a, b) => b.sizeBytes - a.sizeBytes || b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { sizeBytes, objectCount, detachedNodes, classes: rows };
  } finally {
    closeSync(descriptor);
  }
}

class JsonInput {
  private readonly buffer = Buffer.allocUnsafe(64 * 1024);
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private text = '';
  private position = 0;
  private ended = false;

  private readonly descriptor: number;

  constructor(descriptor: number) {
    this.descriptor = descriptor;
  }

  private peek(): number {
    while (this.position === this.text.length && !this.ended) {
      const length = readSync(this.descriptor, this.buffer, 0, this.buffer.length, null);
      try {
        this.text = this.decoder.decode(this.buffer.subarray(0, length), { stream: length !== 0 });
      } catch {
        invalid();
      }
      this.position = 0;
      this.ended = length === 0;
    }
    return this.position === this.text.length ? -1 : this.text.charCodeAt(this.position);
  }

  peekValue(): number {
    let code = this.peek();
    while (code === 32 || code === 10 || code === 13 || code === 9) {
      this.position += 1;
      code = this.peek();
    }
    return code;
  }

  private expect(code: number): void {
    if (this.peekValue() !== code) invalid();
    this.position += 1;
  }

  object(value: (key: string) => void): void {
    this.expect(123);
    if (this.peekValue() === 125) {
      this.position += 1;
      return;
    }
    while (true) {
      const key = this.string();
      this.expect(58);
      value(key);
      if (this.peekValue() === 125) {
        this.position += 1;
        return;
      }
      this.expect(44);
    }
  }

  array(value: (index: number) => void): void {
    this.expect(91);
    if (this.peekValue() === 93) {
      this.position += 1;
      return;
    }
    let index = 0;
    while (true) {
      value(index++);
      if (this.peekValue() === 93) {
        this.position += 1;
        return;
      }
      this.expect(44);
    }
  }

  string(): string;
  string(keep: false): undefined;
  string(keep = true): string | undefined {
    this.expect(34);
    const parts = keep ? ['"'] : undefined;
    let escaped = false;
    let unicode = 0;
    while (true) {
      if (this.peek() === -1) invalid();
      const start = this.position;
      while (this.position < this.text.length) {
        const code = this.text.charCodeAt(this.position++);
        if (unicode !== 0) {
          if (!(code >= 48 && code <= 57) && !(code >= 65 && code <= 70) && !(code >= 97 && code <= 102)) invalid();
          unicode -= 1;
        } else if (escaped) {
          if (code === 117) unicode = 4;
          else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(code)) invalid();
          escaped = false;
        } else if (code === 34) {
          if (!keep) return undefined;
          parts!.push(this.text.slice(start, this.position));
          return JSON.parse(parts!.join(''));
        } else if (code === 92) escaped = true;
        else if (code < 32) invalid();
      }
      parts?.push(this.text.slice(start, this.position));
    }
  }

  uint(): number {
    const first = this.peekValue();
    if (first < 48 || first > 57) invalid();
    let value = first - 48;
    this.position += 1;
    if (first === 48 && this.peek() >= 48 && this.peek() <= 57) invalid();
    while (this.peek() >= 48 && this.peek() <= 57) {
      value = value * 10 + this.peek() - 48;
      this.position += 1;
      if (!Number.isSafeInteger(value)) invalid();
    }
    return value;
  }

  skip(): void {
    const code = this.peekValue();
    if (code === 34) {
      this.string(false);
      return;
    }
    if (code === 91) {
      this.array(() => this.skip());
      return;
    }
    if (code === 123) {
      this.expect(123);
      if (this.peekValue() === 125) {
        this.position += 1;
        return;
      }
      while (true) {
        this.string(false);
        this.expect(58);
        this.skip();
        if (this.peekValue() === 125) {
          this.position += 1;
          return;
        }
        this.expect(44);
      }
    }
    if (code === 116 || code === 102 || code === 110) {
      const literal = code === 116 ? 'true' : code === 102 ? 'false' : 'null';
      for (let index = 0; index < literal.length; index += 1) {
        if (this.peek() !== literal.charCodeAt(index)) invalid();
        this.position += 1;
      }
      return;
    }
    if (code === 45) this.position += 1;
    const first = this.peek();
    if (first < 48 || first > 57) invalid();
    this.position += 1;
    if (first !== 48) this.digits();
    if (this.peek() === 46) {
      this.position += 1;
      this.digits(true);
    }
    if (this.peek() === 69 || this.peek() === 101) {
      this.position += 1;
      if (this.peek() === 43 || this.peek() === 45) this.position += 1;
      this.digits(true);
    }
  }

  private digits(required = false): void {
    let count = 0;
    while (this.peek() >= 48 && this.peek() <= 57) {
      this.position += 1;
      count += 1;
    }
    if (required && count === 0) invalid();
  }
}

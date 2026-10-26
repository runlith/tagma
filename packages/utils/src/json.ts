function whole(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

import type { StructuredValue } from './object.js';

type ObjectFrame = {
  readonly kind: 'object';
  readonly parent: ContainerFrame | null;
  readonly fields: Record<string, StructuredValue>;
  key: string;
};

type ArrayFrame = {
  readonly kind: 'array';
  readonly parent: ContainerFrame | null;
  readonly items: StructuredValue[];
};

type ContainerFrame = ObjectFrame | ArrayFrame;

type Mode =
  | 'firstValue'
  | 'value'
  | 'firstKey'
  | 'key'
  | 'afterKey'
  | 'afterValue'
  | 'string'
  | 'escape'
  | 'unicode'
  | 'number'
  | 'literal'
  | 'done';

type NumberMode = 'sign' | 'zero' | 'int' | 'dot' | 'frac' | 'exp' | 'expSign' | 'expDigits';

type NumberStep = NumberMode | 'end' | 'illegal';

const LITERALS: Record<string, string> = { t: 'true', f: 'false', n: 'null' };

const LITERAL_VALUES = new Map<string, StructuredValue>([
  ['true', true],
  ['false', false],
  ['null', null],
]);

const ESCAPED = new Map<string, string>([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

function put<V>(target: Record<string, V>, key: string, value: V): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

export function toJson(value: unknown): StructuredValue {
  return crossed(value, []) ?? null;
}

function crossed(value: unknown, path: object[]): StructuredValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return value.toString();
    case 'object':
      return value === null ? null : crossedObject(value, path);
    default:
      return undefined;
  }
}

function crossedObject(value: object, path: object[]): StructuredValue | undefined {
  if (path.includes(value)) return undefined;
  path.push(value);
  const own = (value as { readonly toJSON?: unknown }).toJSON;
  const answer =
    typeof own === 'function'
      ? crossed(own.call(value), path)
      : Array.isArray(value)
        ? crossedArray(value, path)
        : crossedRecord(value, path);
  path.pop();
  return answer;
}

function crossedArray(value: readonly unknown[], path: object[]): StructuredValue {
  let copy: StructuredValue[] | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const held = value[index];
    const next = crossed(held, path) ?? null;
    if (copy === null && next !== held) copy = value.slice(0, index) as StructuredValue[];
    if (copy !== null) copy.push(next);
  }
  return copy ?? (value as readonly StructuredValue[]);
}

function crossedRecord(value: object, path: object[]): StructuredValue {
  const proto: unknown = Object.getPrototypeOf(value);
  const plain = proto === Object.prototype || proto === null;
  const source: Record<string, unknown> =
    value instanceof Error ? { ...value, message: value.message } : (value as Record<string, unknown>);
  const keys = Object.keys(source);
  let copy: Record<string, StructuredValue> | null = plain ? null : {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const held = source[key];
    const next = crossed(held, path);
    if (copy === null && (next !== held || next === undefined)) {
      copy = {};
      for (const kept of keys.slice(0, index)) put(copy, kept, source[kept] as StructuredValue);
    }
    if (copy !== null && next !== undefined) put(copy, key, next);
  }
  return copy ?? (value as StructuredValue);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isHexDigit(char: string): boolean {
  return isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F');
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function advanceNumber(mode: NumberMode, char: string): NumberStep {
  switch (mode) {
    case 'sign':
      if (char === '0') return 'zero';
      return isDigit(char) ? 'int' : 'illegal';
    case 'zero':
      if (char === '.') return 'dot';
      if (char === 'e' || char === 'E') return 'exp';
      return isDigit(char) ? 'illegal' : 'end';
    case 'int':
      if (isDigit(char)) return 'int';
      if (char === '.') return 'dot';
      if (char === 'e' || char === 'E') return 'exp';
      return 'end';
    case 'dot':
      return isDigit(char) ? 'frac' : 'illegal';
    case 'frac':
      if (isDigit(char)) return 'frac';
      if (char === 'e' || char === 'E') return 'exp';
      return 'end';
    case 'exp':
      if (char === '+' || char === '-') return 'expSign';
      return isDigit(char) ? 'expDigits' : 'illegal';
    case 'expSign':
      return isDigit(char) ? 'expDigits' : 'illegal';
    case 'expDigits':
      return isDigit(char) ? 'expDigits' : 'end';
  }
}

export type PartialJsonField = {
  readonly text: string;
  readonly closed: boolean;
};

export type PartialJsonState = {
  readonly value: StructuredValue;
  readonly complete: boolean;
  readonly completedFields: readonly string[];
};

type FieldSpan = {
  readonly start: number;
  end: number;
  closed: boolean;
};

export type PartialJsonReader = {
  readonly examined: number;
  push(text: string): PartialJsonState | undefined;
  field(name: string): PartialJsonField | undefined;
};

function textThrough(chunks: readonly string[], end: number): string {
  const prefix: string[] = [];
  let remaining = end;
  for (const chunk of chunks) {
    if (remaining <= 0) break;
    if (chunk.length <= remaining) {
      prefix.push(chunk);
      remaining -= chunk.length;
    } else {
      prefix.push(chunk.slice(0, remaining));
      remaining = 0;
    }
  }
  return prefix.join('');
}

export function partialJsonReader(): PartialJsonReader {
  let stack: ContainerFrame | null = null;
  let depth = 0;
  const chunks: string[] = [];
  const completed = new Set<string>();
  let completedFields: readonly string[] = [];
  let mode: Mode = 'firstValue';
  let numberMode: NumberMode = 'int';
  let numberText = '';
  let numberKept = 0;
  let literalWord = '';
  let literalAt = 0;
  let unicodeDigits = 0;
  let unicodeCode = 0;
  let inKey = false;
  let text = '';
  let root: StructuredValue | undefined;
  let topLevelKey: string | undefined;
  const fields = new Map<string, FieldSpan>();
  const duplicated = new Set<string>();
  let openField: string | null = null;
  let kept = 0;
  let confirmed = 0;
  let position = 0;
  let examined = 0;
  let poisonedAt: number | null = null;
  let failed = false;
  let last: PartialJsonState | undefined;
  let lastKept = 0;

  const valueSettled = (value: StructuredValue): Mode => {
    const holder = stack;
    if (holder === null) root = value;
    else if (holder.kind === 'array') holder.items.push(value);
    else put(holder.fields, holder.key, value);
    if (depth === 1 && holder?.kind === 'object' && topLevelKey !== undefined) {
      if (!completed.has(topLevelKey)) {
        completed.add(topLevelKey);
        completedFields = [...completedFields, topLevelKey];
      }
      topLevelKey = undefined;
    }
    return stack === null ? 'done' : 'afterValue';
  };

  const startValue = (char: string, at: number): Mode | null => {
    inKey = false;
    if (char === '"') {
      kept = at + 1;
      text = '';
      return 'string';
    }
    if (char === '{') {
      stack = { kind: 'object', parent: stack, fields: {}, key: '' };
      depth += 1;
      kept = at + 1;
      return 'firstKey';
    }
    if (char === '[') {
      stack = { kind: 'array', parent: stack, items: [] };
      depth += 1;
      kept = at + 1;
      return 'firstValue';
    }
    if (char === '-') {
      numberMode = 'sign';
      numberText = char;
      numberKept = 0;
      return 'number';
    }
    if (isDigit(char)) {
      numberMode = char === '0' ? 'zero' : 'int';
      numberText = char;
      numberKept = 1;
      kept = at + 1;
      return 'number';
    }
    const word = LITERALS[char];
    if (word === undefined) return null;
    literalWord = word;
    literalAt = at;
    kept = at + 1;
    return 'literal';
  };

  const closeContainer = (char: string, at: number): Mode | null => {
    const closing = stack;
    if (closing === null || (char === '}' ? closing.kind !== 'object' : closing.kind !== 'array')) return null;
    stack = closing.parent;
    depth -= 1;
    kept = at + 1;
    return valueSettled(closing.kind === 'object' ? closing.fields : closing.items);
  };

  const poisoned = (): boolean => poisonedAt !== null && kept > poisonedAt;
  const fail = (): undefined => {
    failed = true;
    return undefined;
  };

  const opened = (): StructuredValue | undefined => {
    if (mode === 'string' || mode === 'escape' || mode === 'unicode') return inKey ? undefined : text;
    if (mode === 'number') return numberKept === 0 ? undefined : Number(numberText.slice(0, numberKept));
    if (mode === 'literal') return LITERAL_VALUES.get(literalWord);
    return undefined;
  };

  const snapshot = (): StructuredValue => {
    if (stack === null) return (mode === 'done' ? root : opened()) as StructuredValue;
    let partial = opened();
    for (let frame: ContainerFrame | null = stack; frame !== null; frame = frame.parent) {
      if (frame.kind === 'array') {
        const copy = frame.items.slice();
        if (partial !== undefined) copy.push(partial);
        partial = copy;
      } else {
        const copy = { ...frame.fields };
        if (partial !== undefined) put(copy, frame.key, partial);
        partial = copy;
      }
    }
    return partial as StructuredValue;
  };

  const reading = (): PartialJsonState | undefined => {
    if (kept === 0) return undefined;
    const complete = mode === 'done';
    if (last !== undefined && kept === lastKept) {
      if (last.complete !== complete || last.completedFields !== completedFields) {
        last = { value: last.value, complete, completedFields };
      }
      return last;
    }
    last = { value: snapshot(), complete, completedFields };
    lastKept = kept;
    return last;
  };

  const confirmedField = (name: string): PartialJsonField | undefined => {
    if (failed || duplicated.has(name)) return undefined;
    const span = fields.get(name);
    if (span === undefined || span.start < 0) return undefined;
    const stop = span.closed ? span.end : confirmed;
    if (stop < span.start) return undefined;
    try {
      const text = JSON.parse(`"${textThrough(chunks, stop).slice(span.start)}"`) as string;
      return { text: whole(text), closed: span.closed };
    } catch {
      return undefined;
    }
  };

  const push = (piece: string): PartialJsonState | undefined => {
    if (failed) return undefined;
    if (piece.length > 0) chunks.push(piece);
    const start = position;
    let runAt = 0;

    for (let offset = 0; offset < piece.length; offset += 1) {
      const at = start + offset;
      const char = piece[offset] as string;
      examined += 1;

      if (mode === 'number') {
        const step = advanceNumber(numberMode, char);
        if (step === 'illegal') return fail();
        if (step !== 'end') {
          numberMode = step;
          numberText += char;
          if (step === 'zero' || step === 'int' || step === 'frac' || step === 'expDigits') {
            kept = at + 1;
            numberKept = numberText.length;
          }
          if (poisoned()) return fail();
          continue;
        }
        mode = valueSettled(Number(numberText));
      } else if (mode === 'literal') {
        const wordOffset = at - literalAt;
        if (wordOffset < literalWord.length) {
          if (char !== literalWord[wordOffset]) return fail();
          kept = at + 1;
          if (poisoned()) return fail();
          continue;
        }
        mode = valueSettled(LITERAL_VALUES.get(literalWord) as StructuredValue);
      }

      switch (mode) {
        case 'firstValue':
        case 'value': {
          if (isSpace(char)) break;
          if (char === ']' && mode === 'firstValue' && stack !== null) {
            const next = closeContainer(char, at);
            if (next === null) return fail();
            mode = next;
            break;
          }
          const field = depth === 1 && stack?.kind === 'object' ? topLevelKey : undefined;
          const next = startValue(char, at);
          if (next === null) return fail();
          if (next === 'string') runAt = offset + 1;
          if (field !== undefined) {
            if (fields.has(field)) duplicated.add(field);
            fields.set(field, { start: next === 'string' ? at + 1 : -1, end: -1, closed: false });
            openField = next === 'string' ? field : null;
          }
          mode = next;
          break;
        }

        case 'firstKey':
        case 'key': {
          if (isSpace(char)) break;
          if (char === '}' && mode === 'firstKey') {
            const next = closeContainer(char, at);
            if (next === null) return fail();
            mode = next;
            break;
          }
          if (char !== '"') return fail();
          inKey = true;
          text = '';
          runAt = offset + 1;
          mode = 'string';
          break;
        }

        case 'afterKey':
          if (isSpace(char)) break;
          if (char !== ':') return fail();
          mode = 'value';
          break;

        case 'afterValue': {
          if (isSpace(char)) break;
          if (char === ',') {
            mode = stack?.kind === 'object' ? 'key' : 'value';
            break;
          }
          if (char !== '}' && char !== ']') return fail();
          const next = closeContainer(char, at);
          if (next === null) return fail();
          mode = next;
          break;
        }

        case 'string':
          if (char === '"') {
            text += piece.slice(runAt, offset);
            if (inKey) {
              if (poisonedAt !== null) return fail();
              const holder = stack;
              if (holder?.kind === 'object') holder.key = text;
              if (depth === 1) topLevelKey = text;
              inKey = false;
              mode = 'afterKey';
              break;
            }
            if (openField !== null) {
              const span = fields.get(openField);
              if (span) {
                span.end = at;
                span.closed = true;
              }
              openField = null;
            }
            kept = at + 1;
            mode = valueSettled(text);
            break;
          }
          if (char === '\\') {
            text += piece.slice(runAt, offset);
            mode = 'escape';
            break;
          }
          if (char.charCodeAt(0) < 0x20 && poisonedAt === null) poisonedAt = at;
          if (!inKey) kept = at + 1;
          break;

        case 'escape': {
          if (char === 'u') {
            unicodeDigits = 0;
            unicodeCode = 0;
            mode = 'unicode';
            break;
          }
          const escaped = ESCAPED.get(char);
          if (escaped === undefined) return fail();
          text += escaped;
          runAt = offset + 1;
          mode = 'string';
          if (!inKey) kept = at + 1;
          break;
        }

        case 'unicode':
          if (!isHexDigit(char)) return fail();
          unicodeCode = unicodeCode * 16 + Number.parseInt(char, 16);
          unicodeDigits += 1;
          if (unicodeDigits < 4) break;
          text += String.fromCharCode(unicodeCode);
          runAt = offset + 1;
          mode = 'string';
          if (!inKey) kept = at + 1;
          break;

        case 'done':
          if (!isSpace(char)) return fail();
          break;
      }

      if (poisoned()) return fail();
    }

    if (mode === 'string' && runAt < piece.length) text += piece.slice(runAt);
    position += piece.length;
    confirmed = kept;
    return reading();
  };

  return {
    get examined(): number {
      return examined;
    },
    push,
    field: confirmedField,
  };
}

export function readConfirmedField(text: string, name: string): PartialJsonField | undefined {
  const reader = partialJsonReader();
  reader.push(text);
  return reader.field(name);
}

export function completeJsonState(value: unknown): PartialJsonState {
  return { value: toJson(value), complete: true, completedFields: [] };
}

export function readPartialJsonState(text: string): PartialJsonState | undefined {
  return partialJsonReader().push(text);
}

export function readPartialJson(text: string): StructuredValue | undefined {
  return readPartialJsonState(text)?.value;
}

import type { Protocol } from 'devtools-protocol';
import { ENTRY_CHARS, STACK_FRAMES } from '../contract/wire/rows.js';

type Remote = Protocol.Runtime.RemoteObject;
type Preview = Protocol.Runtime.ObjectPreview;
type Property = Protocol.Runtime.PropertyPreview;

const FRAME_CHARS = 300;
const SOURCE_CHARS = 120;
const FORMAT_CHARS = 4 * ENTRY_CHARS;
const ARGS_READ = 256;

const DESCRIBED = new Set([
  'arraybuffer',
  'dataview',
  'date',
  'error',
  'internal#entry',
  'node',
  'regexp',
  'trustedtype',
  'webassemblymemory',
]);

const INTERNAL = ['[[PromiseState]]', '[[PromiseResult]]', '[[GeneratorState]]', '[[PrimitiveValue]]', '[[WeakRefTarget]]'];

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
};

const escapeOf = (char: string): string => {
  const known = ESCAPES[char];
  if (known !== undefined) return known;
  const code = char.charCodeAt(0);
  return code < 0x100 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
};

const quoted = (text: string): string => {
  const quote = !text.includes("'") ? "'" : !text.includes('"') ? '"' : !text.includes('`') && !text.includes('${') ? '`' : "'";
  const escaped = text.replace(/[\\\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, escapeOf).replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
};

const until = (text: string, stop: string): string => {
  const at = text.indexOf(stop);
  return at === -1 ? text : text.slice(0, at);
};

const headline = (description: string): string => {
  const stack = description.search(/\n\s+at /u);
  return stack === -1 ? description : description.slice(0, stack);
};

const abbreviated = (description: string): string => (description === 'Object' ? '{…}' : description);

const valueOf = (type: string, subtype: string | undefined, value = ''): string => {
  if (type === 'accessor') return '(...)';
  if (type === 'function') return 'ƒ';
  if (type === 'string') return quoted(value);
  if (type === 'object') return subtype === undefined ? abbreviated(value) : subtype === 'error' ? headline(value) : value;
  return value;
};

const propertyOf = (property: Property): string =>
  property.valuePreview === undefined ? valueOf(property.type, property.subtype, property.value) : previewed(property.valuePreview);

const rank = (property: Property): number => {
  const internal = INTERNAL.indexOf(property.name);
  if (internal !== -1) return internal;
  return property.type !== 'function' && !property.name.startsWith('#') ? INTERNAL.length : INTERNAL.length + 1;
};

const named = (name: string): string => (/^\s|\s$|^$|\n/u.test(name) ? `"${name.replaceAll('\n', '↵')}"` : name);

const lengthOf = (preview: Preview): number => Number(/[[(](\d+)[\])]$/u.exec(preview.description ?? '')?.[1] ?? 0);

const arrayItems = (preview: Preview): string[] => {
  const length = lengthOf(preview);
  const indexOf = (name: string): number => {
    const index = Number(name) >>> 0;
    return String(index) === name && index < length ? index : -1;
  };
  const items: string[] = [];
  const gap = (count: number) => {
    if (count > 0 && !preview.overflow) items.push(count === 1 ? 'empty' : `empty × ${count}`);
  };
  let previous = -1;
  for (const property of preview.properties.filter((held) => indexOf(held.name) !== -1)) {
    const index = indexOf(property.name);
    gap(index - previous - 1);
    items.push(preview.overflow && index !== items.length ? `${property.name}: ${propertyOf(property)}` : propertyOf(property));
    previous = index;
  }
  gap(length - previous - 1);
  for (const property of preview.properties.filter((held) => indexOf(held.name) === -1).sort((a, b) => rank(a) - rank(b)))
    items.push(`${named(property.name)}: ${propertyOf(property)}`);
  return items;
};

const objectItems = (preview: Preview): string[] => {
  const items: string[] = [];
  const properties = preview.properties.filter((property) => property.type !== 'accessor').sort((a, b) => rank(a) - rank(b));
  for (let at = 0; at < properties.length; at += 1) {
    const property = properties[at]!;
    if (preview.subtype === 'promise' && property.name === '[[PromiseState]]') {
      const result = properties[at + 1]?.name === '[[PromiseResult]]' ? properties[++at] : undefined;
      items.push(
        result === undefined || property.value === 'pending' ? `<${property.value}>` : `<${property.value}>: ${propertyOf(result)}`,
      );
    } else if (preview.subtype === 'generator' && property.name === '[[GeneratorState]]') items.push(`<${property.value}>`);
    else if (property.name === '[[PrimitiveValue]]') items.push(propertyOf(property));
    else if (property.name === '[[WeakRefTarget]]') items.push(property.type === 'undefined' ? '<cleared>' : propertyOf(property));
    else items.push(`${named(property.name)}: ${propertyOf(property)}`);
  }
  return items;
};

const previewed = (preview: Preview): string => {
  const description = preview.description ?? '';
  if (preview.type !== 'object' || (preview.subtype !== undefined && DESCRIBED.has(preview.subtype)))
    return valueOf(preview.type, preview.subtype, description);
  const array = preview.subtype === 'array' || preview.subtype === 'typedarray';
  const length = lengthOf(preview);
  const name = array ? description.replace(/[[(]\d+[\])]$/u, '') : description;
  const prefix = array ? `${name === 'Array' ? '' : name}${length > 1 ? `(${length})` : ''}` : description === 'Object' ? '' : description;
  const items =
    preview.entries !== undefined
      ? preview.entries.map(({ key, value }) =>
          key === undefined
            ? valueOf(value.type, value.subtype, value.description)
            : `${valueOf(key.type, key.subtype, key.description)} => ${valueOf(value.type, value.subtype, value.description)}`,
        )
      : array
        ? arrayItems(preview)
        : objectItems(preview);
  if (preview.overflow) items.push('…');
  const body = array ? `[${items.join(', ')}]` : `{${items.join(', ')}}`;
  return prefix === '' ? body : `${prefix} ${body}`;
};

const parameters = (description: string): string => {
  const open = description.indexOf('(');
  if (open === -1) return until(description, '{').trim();
  let depth = 0;
  for (let at = open; at < Math.min(description.length, open + SOURCE_CHARS); at += 1) {
    depth += description[at] === '(' ? 1 : description[at] === ')' ? -1 : 0;
    if (depth === 0) return description.slice(0, at + 1);
  }
  return description.slice(0, open + SOURCE_CHARS);
};

const source = (description: string): string => {
  const signature = /^class\b/u.test(description)
    ? until(description, '{').trim()
    : /^(async\s+)?function\b/u.test(description)
      ? `ƒ ${parameters(description).replace(/^(async\s+)?function\s*/u, '$1')}`
      : until(description, '\n');
  return signature.length > SOURCE_CHARS ? `${signature.slice(0, SOURCE_CHARS)}…` : signature;
};

export const said = (value: Remote): string => {
  if (value.type === 'string') return String(value.value ?? '');
  if (value.unserializableValue !== undefined) return value.unserializableValue;
  if (value.type === 'undefined') return 'undefined';
  if (value.type === 'function') return source(value.description ?? 'ƒ');
  if (value.type === 'object' && value.subtype === 'error') return headline(value.description ?? 'Error');
  if (value.type === 'object' && value.preview !== undefined && value.subtype !== 'node' && value.subtype !== 'trustedtype')
    return previewed(value.preview);
  if (value.value !== undefined) return JSON.stringify(value.value);
  return value.description ?? value.type;
};

const spelled = (value: Remote): string =>
  value.type === 'object' || value.type === 'function' ? (value.description ?? value.type) : said(value);

const numeric = (value: Remote, integer: boolean): string => {
  if (value.type === 'bigint') return said(value);
  if (value.type !== 'number') return 'NaN';
  const number = typeof value.value === 'number' ? value.value : Number(value.unserializableValue);
  return String(integer ? Math.trunc(number) : number);
};

const piece = (specifier: string, value: Remote): string => {
  if (specifier === 'c') return '';
  if (specifier === 's') return spelled(value);
  if (specifier === 'd' || specifier === 'i') return numeric(value, true);
  if (specifier === 'f') return numeric(value, false);
  return said(value);
};

const substituted = (given: string, values: readonly Remote[]): { readonly text: string; readonly used: number } => {
  let format = given.slice(0, FORMAT_CHARS);
  let text = '';
  let used = 0;
  let at = 0;
  while (at < format.length && text.length <= ENTRY_CHARS) {
    const mark = format.indexOf('%', at);
    if (mark === -1 || mark + 1 === format.length) {
      text += format.slice(at);
      break;
    }
    text += format.slice(at, mark);
    const specifier = format[mark + 1]!;
    at = mark + 2;
    const value = 'sdifoOc'.includes(specifier) ? values[used] : undefined;
    if (specifier === '%') text += '%';
    else if (value === undefined) text += `%${specifier}`;
    else if (specifier === 's' && value.type === 'string') {
      used += 1;
      format = `${String(value.value ?? '').slice(0, FORMAT_CHARS)}${format.slice(at)}`.slice(0, FORMAT_CHARS);
      at = 0;
    } else {
      used += 1;
      text += piece(specifier, value);
    }
  }
  return { text, used };
};

const appended = (head: string | null, values: readonly Remote[]): string => {
  let text = head;
  for (const value of values) {
    if (text !== null && text.length > ENTRY_CHARS) break;
    text = text === null ? said(value) : `${text} ${said(value)}`;
  }
  return text ?? '';
};

export const spoken = (args: readonly Remote[]): string => {
  const read = args.slice(0, ARGS_READ);
  const tail = args.length > ARGS_READ ? ' …' : '';
  const [first, ...rest] = read;
  if (first === undefined) return '';
  if (first.type !== 'string') return `${appended(null, read)}${tail}`;
  const { text, used } = substituted(String(first.value ?? ''), rest);
  return `${appended(text, rest.slice(used))}${tail}`;
};

const framed = (line: string): string => (line.length > FRAME_CHARS ? `${line.slice(0, FRAME_CHARS)}…` : line);

const cut = (kept: readonly string[], total: number): string | null => {
  if (total === 0) return null;
  const lines = kept.map(framed);
  return total > lines.length ? [...lines, `… ${total - lines.length} more frames`].join('\n') : lines.join('\n');
};

export const traced = (trace: Protocol.Runtime.StackTrace | undefined): string | null => {
  const frames = trace?.callFrames ?? [];
  return cut(
    frames
      .slice(0, STACK_FRAMES)
      .map(
        (frame) =>
          `at ${frame.functionName || '<anonymous>'} (${frame.url || '<anonymous>'}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`,
      ),
    frames.length,
  );
};

export const errorStack = (args: readonly Remote[]): string | null => {
  const error = args.slice(0, ARGS_READ).find((value) => value.type === 'object' && value.subtype === 'error');
  const description = error?.description;
  if (description === undefined) return null;
  const start = description.search(/\n\s+at /u);
  if (start === -1) return null;
  const frames = description
    .slice(start + 1)
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '));
  return cut(
    frames.slice(0, STACK_FRAMES).map((line) => line.trim()),
    frames.length,
  );
};

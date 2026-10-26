import { type Schema, SchemaAST } from 'effect';
import { printerOf } from '@runlith/utils/printed';

export function plainLines(value: unknown, indent = 0): string[] {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.split('\n').map((line) => `${pad}${line}`);
  if (typeof value !== 'object') return [`${pad}${String(value)}`];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item === null || item === undefined) return [];
      if (typeof item !== 'object' && !(typeof item === 'string' && item.includes('\n'))) {
        return [`${pad}- ${String(item)}`];
      }
      return [`${pad}-`, ...plainLines(item, indent + 1)];
    });
  }
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'string' && !entry.includes('\n')) {
      lines.push(`${pad}${key}: ${entry}`);
    } else if (typeof entry !== 'object' && typeof entry !== 'string') {
      lines.push(`${pad}${key}: ${String(entry)}`);
    } else {
      const child = plainLines(entry, indent + 1);
      if (child.length === 0) continue;
      lines.push(`${pad}${key}:`);
      lines.push(...child);
    }
  }
  return lines;
}

export function* textLines(text: string): Generator<string> {
  let from = 0;
  for (;;) {
    const at = text.indexOf('\n', from);
    if (at === -1) {
      yield text.slice(from);
      return;
    }
    yield text.slice(from, at);
    from = at + 1;
  }
}

const resolved = (ast: SchemaAST.AST): SchemaAST.AST => (SchemaAST.isSuspend(ast) ? resolved(ast.thunk()) : ast);

const fits = (ast: SchemaAST.AST, value: unknown): boolean => {
  switch (ast._tag) {
    case 'Objects':
    case 'ObjectKeyword':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'Arrays':
      return Array.isArray(value);
    case 'Literal':
      return ast.literal === value;
    case 'String':
    case 'TemplateLiteral':
      return typeof value === 'string';
    case 'Number':
      return typeof value === 'number';
    case 'Boolean':
      return typeof value === 'boolean';
    case 'Null':
    case 'Undefined':
    case 'Void':
    case 'Never':
      return false;
    default:
      return true;
  }
};

const named = (ast: SchemaAST.AST, value: unknown): boolean =>
  ast._tag !== 'Objects' ||
  ast.propertySignatures.every((signature) => {
    const held = (value as Readonly<Record<PropertyKey, unknown>>)[signature.name];
    const type = resolved(signature.type);
    if (type._tag === 'Literal') return held === type.literal;
    return held !== undefined || SchemaAST.isOptional(signature.type);
  });

const memberOf = (union: SchemaAST.Union, value: unknown): SchemaAST.AST | undefined => {
  const fitting = union.types.map(resolved).filter((member) => fits(member, value));
  return fitting.find((member) => named(member, value)) ?? fitting[0];
};

const blank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && Object.values(value).every(blank));

const scalarText = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `${value.byteLength} bytes`;
  return typeof value === 'object' ? null : String(value);
};

function* fieldsOf(ast: SchemaAST.AST, value: object, pad: string, root: boolean): Generator<string> {
  const declared =
    ast._tag === 'Objects' ? [...ast.propertySignatures].sort((a, b) => Number(b.name === 'status') - Number(a.name === 'status')) : [];
  const seen = new Set<PropertyKey>();
  for (const signature of declared) {
    seen.add(signature.name);
    const held = (value as Readonly<Record<PropertyKey, unknown>>)[signature.name];
    if (root && signature.name === 'status' && held === 'ok') continue;
    yield* entryLines(String(signature.name), signature.type, held, pad);
  }
  for (const [key, held] of Object.entries(value)) {
    if (seen.has(key) || (root && key === 'status' && held === 'ok')) continue;
    yield* entryLines(key, SchemaAST.unknown, held, pad);
  }
}

function* itemLines(ast: SchemaAST.AST, value: unknown, pad: string): Generator<string> {
  let first = true;
  for (const line of valueLines(ast, value, `${pad}  `)) {
    yield first ? `${pad}- ${line.slice(pad.length + 2)}` : line;
    first = false;
  }
}

function* valueLines(declared: SchemaAST.AST, value: unknown, pad: string): Generator<string> {
  const outer = resolved(declared);
  const ast = outer._tag === 'Union' ? (memberOf(outer, value) ?? outer) : outer;
  const printer = printerOf(ast) ?? printerOf(outer);
  if (printer !== undefined) {
    for (const line of printer(value)) yield `${pad}${line}`;
    return;
  }
  const scalar = scalarText(value);
  if (scalar !== null) {
    for (const line of textLines(scalar)) yield `${pad}${line}`;
    return;
  }
  if (Array.isArray(value)) {
    const items = ast._tag === 'Arrays' ? ast : null;
    for (const [index, item] of value.entries()) {
      if (item === null || item === undefined) continue;
      const itemAst = items?.elements[index] ?? items?.rest[0] ?? SchemaAST.unknown;
      yield* itemLines(itemAst, item, pad);
    }
    return;
  }
  yield* fieldsOf(ast, value as object, pad, false);
}

function* entryLines(key: string, declared: SchemaAST.AST, value: unknown, pad: string): Generator<string> {
  if (value === null || value === undefined) return;
  if (blank(value)) {
    yield `${pad}${key}: none`;
    return;
  }
  const lines = valueLines(declared, value, `${pad}  `);
  const first = lines.next();
  if (first.done === true) return;
  const second = lines.next();
  if (second.done === true && !Array.isArray(value) && (scalarText(value) !== null || printerOf(resolved(declared)) !== undefined)) {
    yield `${pad}${key}: ${first.value.trimStart()}`;
    return;
  }
  yield `${pad}${key}:`;
  yield first.value;
  if (second.done !== true) yield second.value;
  yield* lines;
}

export function* documentLines(schema: Schema.Top, value: unknown): Generator<string> {
  if (value === null || value === undefined) return;
  const outer = resolved(SchemaAST.toType(schema.ast));
  const ast = outer._tag === 'Union' ? (memberOf(outer, value) ?? outer) : outer;
  if (typeof value === 'object' && !Array.isArray(value) && scalarText(value) === null) {
    yield* fieldsOf(ast, value, '', true);
    return;
  }
  yield* valueLines(ast, value, '');
}

export function plainInline(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(plainInline).join(', ');
  return Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => `${key} ${typeof entry === 'object' ? `(${plainInline(entry)})` : String(entry)}`)
    .join(' · ');
}

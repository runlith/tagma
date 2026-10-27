import { failureOf, parsedNow, scriptsWith } from '@runlith/code-facts/js/imports';

export const script = (path: string): boolean => /\.[cm]?[jt]sx?$/.test(path);

export type Span = { readonly from: number; readonly to: number; readonly at: number };
export type Edit =
  | { readonly kind: 'inert' }
  | { readonly kind: 'load'; readonly at: number; readonly why: string }
  | { readonly kind: 'lines'; readonly spans: readonly Span[] };

type Node = { readonly type: string; readonly start: number; readonly end: number; readonly [key: string]: unknown };
type Container = {
  readonly kind: 'function' | 'class';
  readonly start: number;
  readonly end: number;
  readonly first: number;
  readonly last: number;
  readonly members: readonly Node[];
  readonly instance: readonly (readonly [number, number])[];
};
type Hunk = { readonly a: number; readonly aEnd: number; readonly b: number; readonly bEnd: number };
type Source = {
  readonly text: string;
  readonly lines: readonly string[];
  readonly starts: readonly number[];
  readonly body: readonly Node[];
  readonly containers: readonly Container[];
};

const MAX_DISTANCE = 2000;
const CONSTRUCTORS = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'Array',
  'Object',
  'Error',
  'TypeError',
  'RangeError',
  'RegExp',
  'Date',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'ArrayBuffer',
  'Uint8Array',
]);
const CALLS = new Set(['Symbol', 'Symbol.for', 'Object.freeze', 'String', 'Number', 'Boolean', 'BigInt']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'StaticBlock']);
const RECORDS = new Set(['ImportDeclaration', 'ExportAllDeclaration']);
const transpilers = new Map<string, Bun.Transpiler>();

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
const child = (value: unknown): Node | undefined => (isNode(value) ? value : undefined);
const children = (value: unknown): Node[] => (Array.isArray(value) ? value.filter(isNode) : []);

const walk = (root: Node, visit: (node: Node) => void): void => {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    for (const value of Object.values(node))
      if (Array.isArray(value)) for (const item of value) isNode(item) && stack.push(item);
      else if (isNode(value)) stack.push(value);
  }
};

const lineAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
};

const sourceOf = (path: string, text: string): Source | undefined => {
  const parsed = parsedNow(path, scriptsWith([])(text, path)[0]!);
  if (failureOf(parsed) !== undefined) return undefined;
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const program = parsed.program as unknown as Node;
  const containers: Container[] = [];
  const interior = (node: Node): readonly [number, number] => {
    const first = lineAt(starts, node.start);
    const last = lineAt(starts, node.end);
    return last - first <= 1 ? [first, last] : [first + 1, last - 1];
  };
  walk(program, (node) => {
    if (FUNCTIONS.has(node.type))
      containers.push({
        kind: 'function',
        start: node.start,
        end: node.end,
        first: lineAt(starts, node.start),
        last: lineAt(starts, node.end),
        members: [],
        instance: [],
      });
    else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const body = child(node['body']);
      if (body === undefined) return;
      const members = children(body['body']);
      const instance = members.flatMap((member): (readonly [number, number])[] => {
        if (member['static'] === true) return [];
        if (member.type === 'PropertyDefinition' && child(member['value']) !== undefined)
          return [[lineAt(starts, member.start), lineAt(starts, member.end)]];
        const constructor = member.type === 'MethodDefinition' && member['kind'] === 'constructor' ? child(member['value']) : undefined;
        if (constructor === undefined) return [];
        const [from, to] = interior(constructor);
        return to - from >= 0 && lineAt(starts, constructor.end) - lineAt(starts, constructor.start) >= 2 ? [[from, to]] : [];
      });
      containers.push({
        kind: 'class',
        start: body.start,
        end: body.end,
        first: lineAt(starts, node.start),
        last: lineAt(starts, body.end),
        members,
        instance,
      });
    }
  });
  return { text, lines, starts, body: children(program['body']), containers };
};

const inside = (source: Source, from: number, to: number): Container | undefined => {
  let found: Container | undefined;
  for (const container of source.containers)
    if (container.start < from && to < container.end && (found === undefined || container.end - container.start < found.end - found.start))
      found = container;
  return found;
};

const named = (node: Node | undefined): string | undefined => {
  if (node?.type === 'Identifier') return node['name'] as string;
  if (node?.type === 'MemberExpression' && node['computed'] !== true) {
    const object = named(child(node['object']));
    const property = child(node['property']);
    return object === undefined || property?.type !== 'Identifier' ? undefined : `${object}.${property['name'] as string}`;
  }
  return undefined;
};

const unwrapped = (node: Node | undefined): Node | undefined =>
  node !== undefined &&
  [
    'ParenthesizedExpression',
    'TSAsExpression',
    'TSSatisfiesExpression',
    'TSNonNullExpression',
    'TSTypeAssertion',
    'TSInstantiationExpression',
    'ChainExpression',
  ].includes(node.type)
    ? unwrapped(child(node['expression']))
    : node;

const constant = (value: Node | undefined): boolean => {
  const node = unwrapped(value);
  if (node === undefined) return false;
  if (node.type === 'Literal') return true;
  if (node.type === 'TemplateLiteral') return children(node['expressions']).every(constant);
  if (node.type === 'UnaryExpression') return node['operator'] !== 'delete' && constant(child(node['argument']));
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression')
    return constant(child(node['left'])) && constant(child(node['right']));
  return false;
};

const made = (value: Node | undefined, bound: ReadonlySet<string>): boolean => {
  const node = unwrapped(value);
  if (node === undefined) return false;
  if (node.type === 'Identifier' || node.type === 'MetaProperty' || node.type === 'ThisExpression' || node.type === 'MemberExpression')
    return false;
  return node.type === 'Literal' || node.type === 'TemplateLiteral' || pure(node, bound);
};

const pure = (value: Node | undefined, bound: ReadonlySet<string>): boolean => {
  const node = unwrapped(value);
  if (node === undefined) return true;
  const global = (name: string | undefined): boolean => name !== undefined && !bound.has(name.split('.')[0]!);
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
    case 'MetaProperty':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'Super':
      return true;
    case 'TemplateLiteral':
      return children(node['expressions']).every(constant);
    case 'ClassExpression':
      return !acting(node, bound);
    case 'ArrayExpression':
      return (node['elements'] as unknown[]).every(
        (one) => one === null || (isNode(one) && one.type !== 'SpreadElement' && pure(one, bound)),
      );
    case 'ObjectExpression':
      return children(node['properties']).every(
        (one) => one.type === 'Property' && (one['computed'] !== true || constant(child(one['key']))) && pure(child(one['value']), bound),
      );
    case 'UnaryExpression':
      return ['!', 'typeof', 'void'].includes(node['operator'] as string) ? pure(child(node['argument']), bound) : constant(node);
    case 'BinaryExpression':
      return constant(node);
    case 'LogicalExpression':
      return pure(child(node['left']), bound) && pure(child(node['right']), bound);
    case 'ConditionalExpression':
      return pure(child(node['test']), bound) && pure(child(node['consequent']), bound) && pure(child(node['alternate']), bound);
    case 'SequenceExpression':
      return children(node['expressions']).every((one) => pure(one, bound));
    case 'MemberExpression':
      return child(node['object'])?.type === 'MetaProperty' && node['computed'] !== true;
    case 'NewExpression':
    case 'CallExpression': {
      const callee = named(child(node['callee']));
      const known =
        node.type === 'NewExpression' ? callee !== undefined && CONSTRUCTORS.has(callee) : callee !== undefined && CALLS.has(callee);
      return known && global(callee) && children(node['arguments']).every((one) => made(one, bound));
    }
    default:
      return false;
  }
};

const acting = (node: Node, bound: ReadonlySet<string>): boolean => {
  switch (node.type) {
    case 'EmptyStatement':
    case 'FunctionDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
    case 'TSDeclareFunction':
      return false;
    case 'TSModuleDeclaration':
      return node['declare'] !== true;
    case 'TSEnumDeclaration':
      return (
        node['declare'] !== true &&
        node['const'] !== true &&
        children(child(node['body'])?.['members'] ?? node['members']).some((one) => !pure(child(one['initializer']), bound))
      );
    case 'ExportNamedDeclaration': {
      const declaration = child(node['declaration']);
      return declaration !== undefined && acting(declaration, bound);
    }
    case 'ExportDefaultDeclaration': {
      const declaration = child(node['declaration']);
      return (
        declaration !== undefined && (declaration.type.endsWith('Declaration') ? acting(declaration, bound) : !pure(declaration, bound))
      );
    }
    case 'VariableDeclaration':
      return (
        node['declare'] !== true &&
        (!['const', 'let', 'var'].includes(node['kind'] as string) ||
          children(node['declarations']).some((one) => child(one['id'])?.type !== 'Identifier' || !pure(child(one['init']), bound)))
      );
    case 'ClassDeclaration':
    case 'ClassExpression':
      return (
        node['declare'] !== true &&
        (children(node['decorators']).length > 0 ||
          !pure(child(node['superClass']), bound) ||
          children(child(node['body'])?.['body']).some(
            (one) =>
              one.type === 'StaticBlock' ||
              children(one['decorators']).length > 0 ||
              (one['computed'] === true && !pure(child(one['key']), bound)) ||
              (one['static'] === true && one.type !== 'MethodDefinition' && !pure(child(one['value']), bound)),
          ))
      );
    case 'ExpressionStatement':
      return typeof node['directive'] !== 'string';
    default:
      return !RECORDS.has(node.type) && !(node.type === 'ExportNamedDeclaration' && node['declaration'] === null);
  }
};

const record = (node: Node): boolean =>
  RECORDS.has(node.type) || (node.type === 'ExportNamedDeclaration' && child(node['declaration']) === undefined);

const boundOf = (source: Source): Set<string> => {
  const bound = new Set<string>();
  for (const statement of source.body) {
    const declaration = statement.type.startsWith('Export') ? (child(statement['declaration']) ?? statement) : statement;
    if (declaration.type === 'ImportDeclaration')
      for (const one of children(declaration['specifiers'])) bound.add(child(one['local'])?.['name'] as string);
    else for (const name of declaredBy(declaration)) bound.add(name);
  }
  return bound;
};

const declaredBy = (node: Node): string[] => {
  if (node.type === 'VariableDeclaration')
    return children(node['declarations']).flatMap((one) => {
      const names: string[] = [];
      walk(child(one['id'])!, (part) => part.type === 'Identifier' && names.push(part['name'] as string));
      return names;
    });
  const id = child(node['id']);
  return id?.type === 'Identifier' ? [id['name'] as string] : [];
};

type Records = {
  readonly imports: ReadonlyMap<string, string>;
  readonly exports: ReadonlyMap<string, string>;
  readonly stars: readonly string[];
};

const recordsOf = (source: Source): Records => {
  const imports = new Map<string, string>();
  const exports = new Map<string, string>();
  const stars: string[] = [];
  const text = (node: Node | undefined): string =>
    node === undefined ? '' : node.type === 'Literal' ? String(node['value']) : source.text.slice(node.start, node.end);
  for (const statement of source.body) {
    const from = text(child(statement['source']));
    if (statement.type === 'ImportDeclaration' && statement['importKind'] !== 'type')
      for (const one of children(statement['specifiers']))
        if (one['importKind'] !== 'type')
          imports.set(text(child(one['local'])), `${from}\0${one.type === 'ImportSpecifier' ? text(child(one['imported'])) : one.type}`);
    if (statement.type === 'ExportAllDeclaration' && statement['exportKind'] !== 'type')
      stars.push(`${from}\0${text(child(statement['exported']))}`);
    if (statement.type === 'ExportNamedDeclaration' && child(statement['declaration']) === undefined && statement['exportKind'] !== 'type')
      for (const one of children(statement['specifiers']))
        if (one['exportKind'] !== 'type') exports.set(text(child(one['exported'])), `${from}\0${text(child(one['local']))}`);
  }
  return { imports, exports, stars: stars.sort() };
};

const mentions = (text: string, name: string): boolean => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);

const rebound = (before: Records, after: Records, oldCode: string, newCode: string): string | undefined => {
  for (const [name, target] of before.imports)
    if (!after.imports.has(name)) {
      if (mentions(newCode, name)) return `import ${name} is gone while the module still names it`;
    } else if (after.imports.get(name) !== target) return `import ${name} now binds ${after.imports.get(name)!.replace('\0', ' ')}`;
  for (const name of after.imports.keys())
    if (!before.imports.has(name) && mentions(oldCode, name)) return `import ${name} shadows a name the module already used`;
  for (const [name, target] of before.exports)
    if (!after.exports.has(name)) return `export ${name} is gone`;
    else if (after.exports.get(name) !== target) return `export ${name} now names ${after.exports.get(name)!.replace('\0', ' ')}`;
  if (before.stars.join('\n') !== after.stars.join('\n')) return 'export * changed';
  return undefined;
};

const diff = (a: readonly string[], b: readonly string[]): Hunk[] | undefined => {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ a: start, aEnd: endA, b: start, bEnd: endB }];
  const limit = Math.min(n + m, MAX_DISTANCE);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let reached = -1;
  for (let d = 0; d <= limit && reached === -1; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        reached = d;
        break;
      }
    }
  }
  if (reached === -1) return undefined;
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = reached; d > 0; d--) {
    const previous = trace[d]!;
    const at = (k: number): number => previous[k + d]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prior = down ? k + 1 : k - 1;
    const priorX = at(prior);
    const priorY = priorX - prior;
    while (x > (down ? priorX : priorX + 1) && y > (down ? priorY + 1 : priorY)) pairs.push([--x, --y]);
    x = priorX;
    y = priorY;
  }
  while (x > 0 && y > 0) pairs.push([--x, --y]);
  pairs.reverse();
  const hunks: Hunk[] = [];
  let lastA = 0;
  let lastB = 0;
  for (const [pa, pb] of [...pairs, [n, m] as [number, number]]) {
    if (pa > lastA || pb > lastB) hunks.push({ a: start + lastA, aEnd: start + pa, b: start + lastB, bEnd: start + pb });
    lastA = pa + 1;
    lastB = pb + 1;
  }
  return hunks;
};

const meets = (node: Node, from: number, to: number): boolean =>
  from === to ? node.start < from && from < node.end : node.start < to && from < node.end;
const overlapping = (source: Source, from: number, to: number): Node[] => source.body.filter((statement) => meets(statement, from, to));

const spanOf = (source: Source, first: number, end: number): [number, number] =>
  first === end
    ? [
        first < source.starts.length ? source.starts[first]! : source.text.length,
        first < source.starts.length ? source.starts[first]! : source.text.length,
      ]
    : [source.starts[first]!, source.starts[end - 1]! + source.lines[end - 1]!.length];

const within = (container: Container, touched: readonly Node[], at: number): Span[] =>
  container.kind === 'function'
    ? [
        container.last - container.first <= 1
          ? { from: container.first, to: container.last, at }
          : { from: container.first + 1, to: container.last - 1, at },
      ]
    : touched.some((member) => member['static'] === true || member.type === 'StaticBlock') || container.instance.length === 0
      ? [{ from: container.first, to: container.first, at }]
      : container.instance.map(([from, to]) => ({ from, to, at }));

const transpiled = (path: string, text: string): string | undefined => {
  const loader = (path.match(/\.([cm]?)([jt]sx?)$/)?.[2] ?? 'ts') as 'js' | 'jsx' | 'ts' | 'tsx';
  let transpiler = transpilers.get(loader);
  if (transpiler === undefined) {
    transpiler = new Bun.Transpiler({ loader, target: 'bun' });
    transpilers.set(loader, transpiler);
  }
  try {
    return transpiler.transformSync(text);
  } catch {
    return undefined;
  }
};

export const editOf = (path: string, before: string, after: string | undefined): Edit => {
  if (after === undefined) return { kind: 'load', at: 1, why: 'the file is gone' };
  if (before === after) return { kind: 'inert' };
  const oldCode = transpiled(path, before);
  const newCode = transpiled(path, after);
  if (oldCode === undefined || newCode === undefined) return { kind: 'load', at: 1, why: 'the file does not transpile' };
  if (oldCode === newCode) return { kind: 'inert' };
  const old = sourceOf(path, before);
  const next = sourceOf(path, after);
  if (old === undefined || next === undefined) return { kind: 'load', at: 1, why: 'the file does not parse' };
  const records = rebound(recordsOf(old), recordsOf(next), oldCode, newCode);
  if (records !== undefined) return { kind: 'load', at: 1, why: records };
  const hunks = diff(old.lines, next.lines);
  if (hunks === undefined) return { kind: 'load', at: 1, why: `more than ${MAX_DISTANCE} lines changed` };
  const oldOf = new Map<number, number>();
  let shift = 0;
  let cursor = 0;
  for (const hunk of hunks) {
    for (; cursor < hunk.b; cursor++) oldOf.set(cursor + 1, cursor + 1 - shift);
    cursor = hunk.bEnd;
    shift += hunk.bEnd - hunk.b - (hunk.aEnd - hunk.a);
  }
  for (; cursor < next.lines.length; cursor++) oldOf.set(cursor + 1, cursor + 1 - shift);
  const oldBound = boundOf(old);
  const nextBound = boundOf(next);
  const spans: Span[] = [];
  for (const hunk of hunks) {
    const at = hunk.a + 1;
    const [from, to] = spanOf(old, hunk.a, hunk.aEnd);
    const [nextFrom, nextTo] = spanOf(next, hunk.b, hunk.bEnd);
    const context = inside(old, from, to);
    const nextContext = inside(next, nextFrom, nextTo);
    const touched = [
      ...(context?.members.filter((member) => meets(member, from, to)) ?? []),
      ...(nextContext?.members.filter((member) => meets(member, nextFrom, nextTo)) ?? []),
    ];
    if (context !== undefined) spans.push(...within(context, touched, at));
    else
      for (const statement of overlapping(old, from, to)) {
        if (record(statement)) continue;
        if (acting(statement, oldBound)) return { kind: 'load', at, why: `a top-level ${statement.type} acts at load` };
        spans.push({ from: lineAt(old.starts, statement.start), to: lineAt(old.starts, statement.end), at });
      }
    if (nextContext !== undefined) {
      const header = oldOf.get(nextContext.first);
      const counterpart = old.containers
        .filter((one) => one.kind === nextContext.kind && one.first === header)
        .sort((left, right) => right.end - right.start - (left.end - left.start))[0];
      if (counterpart !== undefined) spans.push(...within(counterpart, touched, at));
    } else
      for (const statement of overlapping(next, nextFrom, nextTo)) {
        if (record(statement)) continue;
        if (acting(statement, nextBound))
          return { kind: 'load', at: lineAt(next.starts, statement.start), why: `a top-level ${statement.type} acts at load` };
        const declaration = statement.type.startsWith('Export') ? (child(statement['declaration']) ?? statement) : statement;
        const shadow = declaredBy(declaration).find((name) => !oldBound.has(name) && mentions(oldCode, name));
        if (shadow !== undefined) return { kind: 'load', at, why: `the new top-level ${shadow} shadows a name the module already uses` };
      }
    for (let line = hunk.a + 1; line <= hunk.aEnd; line++)
      if (overlapping(old, old.starts[line - 1]!, old.starts[line - 1]! + old.lines[line - 1]!.length).every((one) => !record(one)))
        spans.push({ from: line, to: line, at: line });
  }
  return spans.length === 0 ? { kind: 'inert' } : { kind: 'lines', spans };
};

export const acts = (path: string, text: string): boolean => {
  if (!script(path)) return !/\.json$/.test(path);
  const source = sourceOf(path, text);
  if (source === undefined) return true;
  const bound = boundOf(source);
  return source.body.some((statement) => !record(statement) && acting(statement, bound));
};

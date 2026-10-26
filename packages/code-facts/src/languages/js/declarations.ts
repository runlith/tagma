import type { DeclarationKind } from '../../adapter';
import { type ImportSite, UnsupportedSource } from '../../imports';
import type { Binding, Declared, LiteralPosition, Made, Outline, Published, Query, Shape, TagLiteral, Union } from './index';
import { failureOf, type Parsed, parsedNow, type Script, type Scripts, sitesOf } from './imports';

type Node = { readonly type?: unknown; readonly start?: number; readonly end?: number; readonly [key: string]: unknown };

const EQUALITY = new Set(['===', '!==', '==', '!=']);

const LOOKUPS = new Set(['get', 'has']);

const node = (value: unknown): Node | undefined => (value !== null && typeof value === 'object' ? (value as Node) : undefined);

const nodes = (value: unknown): readonly Node[] => (Array.isArray(value) ? (value.filter((one) => node(one) !== undefined) as Node[]) : []);

const nameOf = (value: unknown): string | undefined => {
  const held = node(value);
  if (held?.type === 'Identifier' && typeof held.name === 'string') return held.name;
  if (held?.type === 'Literal' && typeof held.value === 'string') return held.value;
  return undefined;
};

const stringOf = (value: unknown): string | undefined => {
  const held = node(value);
  if (held?.type === 'Literal' && typeof held.value === 'string') return held.value;
  if (held?.type === 'TemplateLiteral' && nodes(held.expressions).length === 0) {
    const cooked = node(nodes(held.quasis)[0]?.value)?.cooked;
    return typeof cooked === 'string' ? cooked : undefined;
  }
  return undefined;
};

const written = (value: unknown): string | undefined => {
  const held = node(value);
  switch (held?.type) {
    case 'Identifier':
      return typeof held.name === 'string' ? held.name : undefined;
    case 'MemberExpression': {
      if (held.computed === true) return undefined;
      const object = written(held.object);
      const property = nameOf(held.property);
      return object === undefined || property === undefined ? undefined : `${object}.${property}`;
    }
    case 'TSQualifiedName': {
      const left = written(held.left);
      const right = nameOf(held.right);
      return left === undefined || right === undefined ? undefined : `${left}.${right}`;
    }
    default:
      return undefined;
  }
};

const tail = (value: unknown): string | undefined => {
  const held = node(value);
  switch (held?.type) {
    case 'Identifier':
      return typeof held.name === 'string' ? held.name : undefined;
    case 'MemberExpression':
      return held.computed === true ? stringOf(held.property) : nameOf(held.property);
    case 'CallExpression':
      return tail(held.callee);
    case 'ChainExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return tail(held.expression);
    default:
      return undefined;
  }
};

const taggish = (name: string | undefined): boolean => {
  if (name === undefined) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '');
  return words.some((word) => /^tags?$/i.test(word)) && /^(?:tags?|ids?)$/i.test(words.at(-1) ?? '');
};

const parameterNames = (fn: Node): readonly (string | undefined)[] =>
  nodes(fn.params).map((param) => {
    const inner = param.type === 'TSParameterProperty' ? node(param.parameter) : param;
    return nameOf(inner?.type === 'AssignmentPattern' ? inner.left : inner);
  });

const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

const callableOf = (init: unknown): Node | undefined => {
  const held = node(init);
  if (held === undefined) return undefined;
  if (FUNCTIONS.has(held.type as string)) return held;
  if (held.type === 'CallExpression') return nodes(held.arguments).find((one) => FUNCTIONS.has(one.type as string));
  return undefined;
};

const lineStarts = (source: string): readonly number[] => {
  const starts = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
};

const lineAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] as number) <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
};

const digest = (text: string): string => {
  let left = 0x811c9dc5;
  let right = 0x01000193 ^ 0x9e3779b9;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
};

const membersOf = (elements: readonly Node[], surface: boolean): readonly string[] =>
  elements.flatMap((one) => {
    if (one.computed === true || one.kind === 'constructor') return [];
    if (surface && (one.accessibility === 'private' || node(one.key)?.type === 'PrivateIdentifier')) return [];
    const name = nameOf(one.key);
    return name === undefined ? [] : [name];
  });

const shapeOf = (value: unknown): Shape => {
  const held = node(value);
  if (held?.type === 'TSTypeLiteral') return { written: 'inline', members: membersOf(nodes(held.members), false) };
  if (held?.type === 'TSTypeReference') {
    const name = written(held.typeName);
    if (name !== undefined)
      return { written: 'named', name, qualified: name.includes('.'), arguments: nodes(node(held.typeArguments)?.params).length };
  }
  return { written: 'other' };
};

type Consts = ReadonlyMap<string, Node>;

const constsOf = (program: Node): Consts => {
  const held = new Map<string, Node>();
  for (const statement of nodes(program.body)) {
    const inner = statement.type === 'ExportNamedDeclaration' ? node(statement.declaration) : statement;
    if (inner?.type !== 'VariableDeclaration' || inner.kind !== 'const') continue;
    for (const declarator of nodes(inner.declarations)) {
      const init = node(declarator.init);
      if (node(declarator.id)?.type === 'Identifier' && init !== undefined) held.set(nameOf(declarator.id) as string, init);
    }
  }
  return held;
};

const parenthesized = (value: unknown): Node | undefined => {
  const held = node(value);
  return held?.type === 'TSParenthesizedType' ? parenthesized(held.typeAnnotation) : held;
};

const asConst = (value: Node): boolean => {
  const annotation = node(value.typeAnnotation);
  return annotation?.type === 'TSTypeReference' && nameOf(annotation.typeName) === 'const';
};

const typed = (value: Node | undefined, needsConst: boolean): Node | undefined => {
  if (value?.type === 'TSSatisfiesExpression' || value?.type === 'ParenthesizedExpression')
    return typed(node(value.expression), needsConst);
  if (value?.type === 'TSAsExpression') return asConst(value) ? typed(node(value.expression), false) : undefined;
  return needsConst ? undefined : value;
};

const queried = (value: Node | undefined, consts: Consts): Node | undefined => {
  const query = parenthesized(value);
  const name = query?.type === 'TSTypeQuery' && node(query.exprName)?.type === 'Identifier' ? nameOf(query.exprName) : undefined;
  return name === undefined ? undefined : consts.get(name);
};

const elementLiterals = (member: Node, consts: Consts): number | undefined => {
  if (member.type !== 'TSIndexedAccessType' || node(member.indexType)?.type !== 'TSNumberKeyword') return undefined;
  const array = typed(queried(node(member.objectType), consts), true);
  if (array?.type !== 'ArrayExpression') return undefined;
  const elements = nodes(array.elements);
  return elements.length === (array.elements as unknown[]).length && elements.every((one) => stringOf(one) !== undefined)
    ? elements.length
    : undefined;
};

const keyLiterals = (member: Node, consts: Consts): number | undefined => {
  if (member.type !== 'TSTypeOperator' || member.operator !== 'keyof') return undefined;
  const object = typed(queried(node(member.typeAnnotation), consts), false);
  if (object?.type !== 'ObjectExpression') return undefined;
  const keys = nodes(object.properties).map((one) => (one.type === 'Property' && one.computed !== true ? nameOf(one.key) : undefined));
  return keys.every((key) => key !== undefined) ? new Set(keys).size : undefined;
};

const madeOf = (value: Node | undefined): Made | undefined => {
  const pipes: string[] = [];
  let held = typed(value, false);
  while (held?.type === 'CallExpression') {
    const callee = node(held.callee);
    if (callee?.type === 'MemberExpression' && callee.computed !== true && nameOf(callee.property) === 'pipe') {
      const steps = nodes(held.arguments).map((one) => written(one.type === 'CallExpression' ? one.callee : one));
      if (steps.some((step) => step === undefined)) return undefined;
      pipes.unshift(...(steps as string[]));
      held = node(callee.object);
      continue;
    }
    const name = written(callee);
    if (name === undefined) return undefined;
    const first = node(nodes(held.arguments)[0]);
    return { callee: name, arms: first?.type === 'ArrayExpression' ? nodes(first.elements).map(madeOf) : [], pipes };
  }
  return undefined;
};

const queryOf = (member: Node, consts: Consts): Query | undefined => {
  const name = member.type === 'TSTypeQuery' ? node(member.exprName) : undefined;
  if (name?.type !== 'TSQualifiedName' || nameOf(name.right) === undefined) return undefined;
  const of = written(name.left);
  if (of === undefined) return undefined;
  const made = node(name.left)?.type === 'Identifier' ? madeOf(consts.get(of)) : undefined;
  return { of, member: nameOf(name.right) as string, made };
};

const unionOf = (value: unknown, consts: Consts): Union => {
  const held = node(value);
  const members = held?.type === 'TSUnionType' ? nodes(held.types) : held === undefined ? [] : [held];
  let literals = 0;
  let records = 0;
  let other = 0;
  const references: string[] = [];
  const queries: Query[] = [];
  for (const member of members) {
    const inner = parenthesized(member);
    if (inner === undefined) continue;
    if (inner.type === 'TSLiteralType' && stringOf(inner.literal) !== undefined) literals += 1;
    else if (inner.type === 'TSTypeReference' && written(inner.typeName) !== undefined) references.push(written(inner.typeName) as string);
    else if (inner.type === 'TSTypeLiteral') records += 1;
    else {
      const listed = elementLiterals(inner, consts) ?? keyLiterals(inner, consts);
      const query = listed === undefined ? queryOf(inner, consts) : undefined;
      if (listed !== undefined) literals += listed;
      else if (query !== undefined) queries.push(query);
      else other += 1;
    }
  }
  return { literals, references, records, queries, other };
};

const genericOf = (statement: Node): true | undefined => (nodes(node(statement.typeParameters)?.params).length > 0 ? true : undefined);

type Heritage = { readonly extends?: string; readonly tag?: string; readonly shape?: Shape };

const heritageOf = (superClass: unknown): Heritage => {
  let held = node(superClass);
  if (held === undefined) return {};
  let tag: string | undefined;
  let params: readonly Node[] | undefined;
  while (held?.type === 'CallExpression' || held?.type === 'TSInstantiationExpression') {
    if (held.type === 'CallExpression') tag ??= stringOf(nodes(held.arguments)[0]);
    const typed = nodes(node(held.typeArguments)?.params);
    if (params === undefined && typed.length > 0) params = typed;
    held = node(held.type === 'CallExpression' ? held.callee : held.expression);
  }
  const name = written(held);
  return {
    extends: name,
    tag,
    shape: params !== undefined && params.length >= 2 ? shapeOf(params[1]) : undefined,
  };
};

const explicitTag = (body: readonly Node[]): string | undefined => {
  for (const member of body) {
    if (member.type !== 'PropertyDefinition' || member.computed === true || nameOf(member.key) !== '_tag') continue;
    const value = node(member.value);
    return stringOf(value?.type === 'TSAsExpression' || value?.type === 'TSSatisfiesExpression' ? value.expression : value);
  }
  return undefined;
};

type Located = (offset: number) => number;

const declared = (statement: Node, lineOf: Located, consts: Consts): readonly Declared[] => {
  const at = (id: unknown): number => lineOf(node(id)?.start ?? statement.start ?? 0);
  const one = (id: unknown, kind: DeclarationKind, extra: Omit<Declared, 'name' | 'kind' | 'line'> = {}): Declared[] => {
    const name = nameOf(id);
    return name === undefined ? [] : [{ name, kind, line: at(id), ...extra }];
  };
  switch (statement.type) {
    case 'VariableDeclaration':
      return nodes(statement.declarations).flatMap((declarator) =>
        patternNames(declarator.id).map(({ name, start }) => ({ name, kind: 'variable' as const, line: lineOf(start) })),
      );
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
      return one(statement.id, 'function');
    case 'ClassDeclaration': {
      const heritage = heritageOf(statement.superClass);
      const implemented = nodes(statement.implements).flatMap((clause) => {
        const name = written(clause.expression);
        return name === undefined ? [] : [name];
      });
      const body = nodes(node(statement.body)?.body);
      const own = explicitTag(body);
      return one(statement.id, 'class', {
        ...heritage,
        tag: own ?? heritage.tag,
        implements: implemented.length === 0 ? undefined : implemented,
        members: membersOf(body, true),
      });
    }
    case 'TSInterfaceDeclaration':
      return one(statement.id, 'interface', {
        members: membersOf(nodes(node(statement.body)?.body), false),
        generic: genericOf(statement),
      });
    case 'TSTypeAliasDeclaration': {
      const aliased = node(statement.typeAnnotation);
      return one(statement.id, 'type', {
        generic: genericOf(statement),
        union: unionOf(aliased, consts),
        members: aliased?.type === 'TSTypeLiteral' ? membersOf(nodes(aliased.members), false) : undefined,
      });
    }
    case 'TSEnumDeclaration':
      return one(statement.id, 'enum');
    case 'TSModuleDeclaration':
      return node(statement.id)?.type === 'Identifier' ? one(statement.id, 'namespace') : [];
    default:
      return [];
  }
};

const patternNames = (pattern: unknown): readonly { readonly name: string; readonly start: number }[] => {
  const held = node(pattern);
  switch (held?.type) {
    case 'Identifier':
      return typeof held.name === 'string' ? [{ name: held.name, start: held.start ?? 0 }] : [];
    case 'ObjectPattern':
      return nodes(held.properties).flatMap((one) => patternNames(one.type === 'RestElement' ? one.argument : one.value));
    case 'ArrayPattern':
      return nodes(held.elements).flatMap(patternNames);
    case 'AssignmentPattern':
      return patternNames(held.left);
    case 'RestElement':
      return patternNames(held.argument);
    default:
      return [];
  }
};

type Reading = {
  readonly exports: Declared[];
  readonly locals: Declared[];
  readonly aliased: Declared[];
  readonly bindings: Binding[];
  readonly requires: Binding[];
  readonly literals: TagLiteral[];
  readonly published: Published[];
  readonly cuts: [number, number][];
  importLines: number;
};

const topLevel = (program: Node, script: Script, lineOf: Located, reading: Reading): void => {
  const locals = new Map<string, Declared[]>();
  const consts = constsOf(program);
  const named: { readonly name: string; readonly local: string }[] = [];
  const own = (declarations: readonly Declared[]) => {
    if (script.module) reading.exports.push(...declarations);
    else reading.locals.push(...declarations);
  };
  const cut = (statement: Node) => {
    if (statement.start !== undefined && statement.end !== undefined)
      reading.cuts.push([script.at + statement.start, script.at + statement.end]);
  };
  for (const statement of nodes(program.body)) {
    switch (statement.type) {
      case 'ImportDeclaration': {
        cut(statement);
        reading.importLines += lineOf(statement.end ?? 0) - lineOf(statement.start ?? 0) + 1;
        const specifier = stringOf(statement.source);
        if (specifier === undefined) break;
        for (const part of nodes(statement.specifiers)) {
          const local = nameOf(part.local);
          if (local === undefined) continue;
          const imported =
            part.type === 'ImportDefaultSpecifier'
              ? 'default'
              : part.type === 'ImportNamespaceSpecifier'
                ? '*'
                : (nameOf(part.imported) ?? local);
          reading.bindings.push({ local, imported, specifier, line: lineOf(node(part.local)?.start ?? statement.start ?? 0) });
        }
        break;
      }
      case 'TSImportEqualsDeclaration': {
        const specifier = stringOf(node(statement.moduleReference)?.expression);
        const id = node(statement.id);
        if (specifier !== undefined && typeof id?.name === 'string')
          reading.requires.push({ local: id.name, imported: '=', specifier, line: lineOf(id.start ?? 0) });
        break;
      }
      case 'ExportAllDeclaration':
        cut(statement);
        break;
      case 'ExportNamedDeclaration': {
        if (statement.source !== null && statement.source !== undefined) {
          cut(statement);
          break;
        }
        const inner = node(statement.declaration);
        if (inner !== undefined) {
          own(declared(inner, lineOf, consts));
          break;
        }
        for (const part of nodes(statement.specifiers)) {
          const local = nameOf(part.local);
          const name = nameOf(part.exported) ?? local;
          if (local !== undefined && name !== undefined) named.push({ name, local });
        }
        break;
      }
      case 'ExportDefaultDeclaration': {
        const inner = node(statement.declaration);
        if (inner?.type === 'Identifier' && typeof inner.name === 'string') named.push({ name: inner.name, local: inner.name });
        else if (inner !== undefined) own(declared(inner, lineOf, consts));
        break;
      }
      default:
        for (const one of declared(statement, lineOf, consts)) {
          const held = locals.get(one.name);
          if (held === undefined) locals.set(one.name, [one]);
          else held.push(one);
        }
    }
  }
  const exported = new Set(named.map(({ local }) => local));
  const ownName = new Set(named.filter(({ name, local }) => name === local).map(({ local }) => local));
  for (const { name, local } of named) own((locals.get(local) ?? []).map((one) => ({ ...one, name })));
  for (const [name, held] of locals) {
    if (!exported.has(name)) reading.locals.push(...held);
    else if (!ownName.has(name)) reading.aliased.push(...held);
  }
};

const walk = (program: Node, script: Script, lineOf: Located, reading: Reading): void => {
  const text = script.text;
  const tags = /tag/i.test(text);
  const pubsub = text.includes('PubSub');
  if (!tags && !pubsub) return;
  const literal = (value: unknown, position: LiteralPosition, near: string | undefined) => {
    const found = stringOf(value);
    const start = node(value)?.start;
    if (found === undefined || near === undefined || start === undefined) return;
    reading.literals.push({ value: found, line: lineOf(script.at + start), position, near });
  };
  const literals = (values: readonly Node[], position: LiteralPosition, near: string | undefined) => {
    for (const value of values) {
      if (value.type === 'ArrayExpression') for (const element of nodes(value.elements)) literal(element, position, near);
      else literal(value, position, near);
    }
  };
  const published = (typed: unknown, at: number | undefined) => {
    const first = nodes(node(typed)?.params)[0];
    const name = first?.type === 'TSTypeReference' ? written(first.typeName) : undefined;
    if (name !== undefined && at !== undefined) reading.published.push({ name, line: lineOf(script.at + at) });
  };
  const callables = new Map<string, (string | undefined)[][]>();
  const callable = (name: string | undefined, fn: Node | undefined) => {
    if (name === undefined || fn === undefined) return;
    const held = callables.get(name);
    if (held === undefined) callables.set(name, [[...parameterNames(fn)]]);
    else held.push([...parameterNames(fn)]);
  };
  const pending: { readonly callee: string; readonly args: readonly Node[] }[] = [];
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const held = node(value);
    if (held === undefined) continue;
    switch (held.type) {
      case 'BinaryExpression':
        if (tags && EQUALITY.has(held.operator as string)) {
          const left = tail(held.left);
          const right = tail(held.right);
          if (taggish(right)) literal(held.left, 'compare', right);
          if (taggish(left)) literal(held.right, 'compare', left);
        }
        break;
      case 'SwitchStatement': {
        const near = tail(held.discriminant);
        if (tags && taggish(near)) for (const one of nodes(held.cases)) literal(one.test, 'compare', near);
        break;
      }
      case 'CallExpression': {
        const callee = node(held.callee);
        const member = callee?.type === 'MemberExpression' ? callee : undefined;
        const object = member === undefined ? undefined : tail(member.object);
        const name = tail(callee);
        if (tags) {
          const args = nodes(held.arguments);
          if (member !== undefined && LOOKUPS.has(name ?? '') && taggish(object)) literals(args, 'lookup', object);
          else if (taggish(name)) literals(args, 'argument', name);
          else if (taggish(object)) literals(args, 'argument', object);
          else if (callee?.type === 'Identifier' && name !== undefined) pending.push({ callee: name, args });
        }
        if (pubsub && member !== undefined && written(member.object) === 'PubSub') published(held.typeArguments, held.start);
        break;
      }
      case 'MemberExpression':
        if (tags && held.computed === true && taggish(tail(held.object))) literal(held.property, 'lookup', tail(held.object));
        break;
      case 'Property':
        if (tags && held.computed !== true && taggish(nameOf(held.key))) literals([node(held.value) ?? {}], 'property', nameOf(held.key));
        break;
      case 'TSTypeReference': {
        const name = written(held.typeName);
        if (pubsub && (name === 'PubSub' || name === 'PubSub.PubSub')) published(held.typeArguments, held.start);
        break;
      }
      case 'FunctionDeclaration':
        if (tags) callable(nameOf(held.id), held);
        break;
      case 'VariableDeclarator':
        if (tags) callable(nameOf(held.id), callableOf(held.init));
        break;
    }
    for (const key in held) {
      if (key === 'start' || key === 'end') continue;
      const child = held[key];
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
  for (const { callee, args } of pending) {
    const signatures = callables.get(callee);
    if (signatures === undefined) continue;
    args.forEach((arg, at) => {
      const parameter = signatures.map((names) => names[at]).find(taggish);
      if (parameter !== undefined) literals([arg], 'argument', parameter);
    });
  }
};

type ParsedScript = { readonly script: Script; readonly parsed: Parsed };

const parsedScripts = (source: string, path: string, scriptsOf: Scripts): readonly ParsedScript[] =>
  scriptsOf(source, path).map((script) => ({ script, parsed: parsedNow(path, script) }));

export function outline(source: string, path: string, scriptsOf: Scripts): Outline {
  return outlineFrom(source, path, parsedScripts(source, path, scriptsOf));
}

export function outlineWithSites(
  source: string,
  path: string,
  scriptsOf: Scripts,
): { readonly value: Outline; readonly sites: readonly ImportSite[] } {
  const parsed = parsedScripts(source, path, scriptsOf);
  return { value: outlineFrom(source, path, parsed), sites: sitesOf(source, path, parsed) };
}

const readTops = (
  source: string,
  path: string,
  scripts: readonly ParsedScript[],
  deep: boolean,
): { reading: Reading; starts: readonly number[] } => {
  const starts = lineStarts(source);
  const lineOf: Located = (offset) => lineAt(starts, offset);
  const reading: Reading = {
    exports: [],
    locals: [],
    aliased: [],
    bindings: [],
    requires: [],
    literals: [],
    published: [],
    cuts: [],
    importLines: 0,
  };
  for (const { script, parsed } of scripts) {
    const failed = failureOf(parsed);
    if (failed !== undefined) {
      const at = failed.labels[0]?.start;
      const where = at === undefined ? '' : ` at line ${lineOf(script.at + at)}`;
      throw new UnsupportedSource(path, `does not parse${where}: ${failed.message}`);
    }
    const program = parsed.program as unknown as Node;
    topLevel(program, script, (offset) => lineOf(script.at + offset), reading);
    if (deep) walk(program, script, lineOf, reading);
  }
  return { reading, starts };
};

const exportedOnce = (exports: readonly Declared[]): Declared[] => {
  const seen = new Set<string>();
  return exports.filter(({ name, kind }) => {
    const key = `${kind}\0${name}`;
    if (name === 'default' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function topDeclarations(
  source: string,
  path: string,
  scriptsOf: Scripts,
): {
  readonly exports: readonly Declared[];
  readonly locals: readonly Declared[];
  readonly aliased: readonly Declared[];
  readonly bindings: readonly Binding[];
} {
  const { reading } = readTops(source, path, parsedScripts(source, path, scriptsOf), false);
  return {
    exports: exportedOnce(reading.exports),
    locals: reading.locals,
    aliased: reading.aliased,
    bindings: [...reading.bindings, ...reading.requires],
  };
}

function outlineFrom(source: string, path: string, scripts: readonly ParsedScript[]): Outline {
  const { reading, starts } = readTops(source, path, scripts, true);
  const exports = exportedOnce(reading.exports);
  let body = '';
  let from = 0;
  for (const [start, end] of [...reading.cuts].sort((left, right) => left[0] - right[0])) {
    if (start > from) body += source.slice(from, start);
    from = Math.max(from, end);
  }
  body += source.slice(from);
  return {
    lines: source === '' ? 0 : starts.length - (source.endsWith('\n') ? 1 : 0),
    importLines: reading.importLines,
    size: Buffer.byteLength(source, 'utf8'),
    exports,
    locals: reading.locals,
    aliased: reading.aliased,
    bindings: reading.bindings,
    literals: reading.literals,
    published: reading.published,
    body: digest(body.replace(/\s+/g, ' ').trim()),
  };
}

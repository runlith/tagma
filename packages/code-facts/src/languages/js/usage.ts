import type { CallProperty, CallUse, PropertyValue, TopUse, Usage, UsageEntry } from './index';
import { UnsupportedSource } from '../../imports';
import { failureOf, type Parsed, parsedNow, type Script, type Scripts } from './imports';

type Node = { readonly type?: unknown; readonly start?: number; readonly end?: number; readonly [key: string]: unknown };

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

const unwrap = (value: unknown): Node | undefined => {
  let held = node(value);
  while (
    held?.type === 'TSAsExpression' ||
    held?.type === 'TSSatisfiesExpression' ||
    held?.type === 'TSTypeAssertion' ||
    held?.type === 'TSNonNullExpression' ||
    held?.type === 'ParenthesizedExpression' ||
    held?.type === 'ChainExpression'
  ) {
    held = node(held.expression);
  }
  return held;
};

const calleeOf = (value: unknown): string | undefined => {
  let held = node(value);
  while (
    held?.type === 'ParenthesizedExpression' ||
    held?.type === 'ChainExpression' ||
    held?.type === 'TSNonNullExpression' ||
    held?.type === 'TSInstantiationExpression'
  ) {
    held = node(held.expression);
  }
  return written(held);
};

const firstOf = (args: readonly Node[]): string | undefined => {
  if (args.length === 0) return undefined;
  const first = unwrap(args[0]);
  if (first === undefined) return undefined;
  if (first.type === 'Literal' && typeof first.value === 'string') return first.value;
  if (first.type === 'TemplateLiteral' && nodes(first.expressions).length === 0) {
    const cooked = node(nodes(first.quasis)[0]?.value)?.cooked;
    if (typeof cooked === 'string') return cooked;
  }
  return written(first);
};

const keysOfObject = (object: Node): readonly string[] => {
  const out: string[] = [];
  for (const property of nodes(object.properties)) {
    if (property.type === 'SpreadElement') continue;
    if (property.computed === true) {
      const key = node(property.key);
      if (key?.type === 'Literal' && typeof key.value === 'string') out.push(key.value);
      continue;
    }
    const name = nameOf(property.key);
    if (name !== undefined) out.push(name);
  }
  return out;
};

const keysForCall = (args: readonly Node[]): readonly string[] => {
  const second = unwrap(args[1]);
  if (second?.type === 'ObjectExpression') return keysOfObject(second);
  const first = unwrap(args[0]);
  if (first?.type === 'ObjectExpression') return keysOfObject(first);
  return [];
};

const firstLiteralOf = (args: readonly Node[]): boolean => {
  const first = unwrap(args[0]);
  if (first?.type === 'Literal' && typeof first.value === 'string') return true;
  return first?.type === 'TemplateLiteral' && nodes(first.expressions).length === 0;
};

const hasSpreadOrComputed = (object: Node): boolean => {
  for (const property of nodes(object.properties)) {
    if (property.type === 'SpreadElement') return true;
    if (property.computed === true) {
      const key = node(property.key);
      if (key?.type !== 'Literal' || typeof key.value !== 'string') return true;
    }
  }
  return false;
};

const valueFormOf = (value: unknown): PropertyValue => {
  const held = unwrap(value);
  if (held === undefined) return { form: 'other' };
  if (held.type === 'CallExpression' || held.type === 'NewExpression') {
    const callee = calleeOf(held.callee);
    return callee === undefined ? { form: 'other' } : { form: 'call', callee };
  }
  if (held.type === 'MemberExpression') {
    const name = written(held);
    return name === undefined ? { form: 'other' } : { form: 'member', name };
  }
  if (held.type === 'Identifier' && typeof held.name === 'string') {
    return held.name === 'undefined' ? { form: 'undefined' } : { form: 'identifier', name: held.name };
  }
  if (held.type === 'UnaryExpression' && held.operator === 'void') return { form: 'void' };
  return { form: 'other' };
};

const typeRefsIn = (root: unknown): readonly string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let at = value.length - 1; at >= 0; at -= 1) stack.push(value[at]);
      continue;
    }
    const held = node(value);
    if (held === undefined) continue;
    if (held.type === 'TSTypeReference') {
      const name = written(held.typeName);
      if (name !== undefined && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    for (const child in held) {
      if (child === 'start' || child === 'end') continue;
      const next = held[child];
      if (next !== null && typeof next === 'object') stack.push(next);
    }
  }
  return out;
};

const typesOfDeclarator = (id: unknown, init: unknown): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushAll = (names: readonly string[]): void => {
    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  };
  pushAll(typeRefsIn(id));
  let current = node(init);
  while (current !== undefined) {
    if (current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression' || current.type === 'TSTypeAssertion') {
      if (current.typeAnnotation !== undefined) pushAll(typeRefsIn(current.typeAnnotation));
      current = node(current.expression);
    } else if (current.type === 'ParenthesizedExpression' || current.type === 'TSNonNullExpression' || current.type === 'ChainExpression') {
      current = node(current.expression);
    } else break;
  }
  return out.sort();
};

type ParsedScript = { readonly script: Script; readonly parsed: Parsed };

type Located = (offset: number) => number;

const byLine = (left: CallUse, right: CallUse): number =>
  left.line - right.line || left.offset - right.offset || (left.callee < right.callee ? -1 : left.callee > right.callee ? 1 : 0);

const readScripts = (source: string, path: string, scriptsOf: Scripts) => {
  const starts = lineStarts(source);
  const lineOf: Located = (offset) => lineAt(starts, offset);
  const scripts = scriptsOf(source, path).map((script) => ({ script, parsed: parsedNow(path, script) }));
  for (const { script, parsed } of scripts) {
    const failed = failureOf(parsed);
    if (failed === undefined) continue;
    const at = failed.labels[0]?.start;
    const where = at === undefined ? '' : ` at line ${lineOf(script.at + at)}`;
    throw new UnsupportedSource(path, `does not parse${where}: ${failed.message}`);
  }
  return { scripts, lineOf };
};

export function usage(source: string, path: string, scriptsOf: Scripts): Usage {
  const { scripts, lineOf } = readScripts(source, path, scriptsOf);
  return usageFrom(scripts, lineOf);
}

function usageFrom(scripts: readonly ParsedScript[], lineOf: Located): Usage {
  type Draft = {
    readonly name: string;
    readonly line: number;
    readonly at: number;
    readonly scanRoot: unknown;
    readonly entriesInit: unknown;
    readonly types: readonly string[];
    exported: boolean;
  };
  const drafts: Draft[] = [];
  const renames: { readonly local: string; readonly module: boolean }[] = [];
  const stray: { readonly root: unknown; readonly at: number }[] = [];
  for (const { script, parsed } of scripts) {
    const program = parsed.program as unknown as Node;
    for (const statement of nodes(program.body)) {
      switch (statement.type) {
        case 'ImportDeclaration':
        case 'ExportAllDeclaration':
          break;
        case 'ExportNamedDeclaration': {
          if (statement.source !== null && statement.source !== undefined) break;
          const inner = node(statement.declaration);
          if (inner !== undefined) {
            collectDeclaration(inner, script, lineOf, true, drafts);
            break;
          }
          for (const part of nodes(statement.specifiers)) {
            const local = nameOf(part.local);
            if (local !== undefined) renames.push({ local, module: script.module });
          }
          break;
        }
        case 'ExportDefaultDeclaration': {
          const inner = node(statement.declaration);
          if (inner?.type === 'Identifier' && typeof inner.name === 'string') {
            renames.push({ local: inner.name, module: script.module });
          } else if (inner !== undefined) {
            const before = drafts.length;
            collectDeclaration(inner, script, lineOf, true, drafts);
            if (drafts.length === before) stray.push({ root: inner, at: script.at });
          }
          break;
        }
        case 'VariableDeclaration':
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
        case 'TSInterfaceDeclaration':
        case 'TSTypeAliasDeclaration':
        case 'TSEnumDeclaration':
        case 'TSModuleDeclaration':
          collectDeclaration(statement, script, lineOf, false, drafts);
          break;
        default:
          stray.push({ root: statement, at: script.at });
      }
    }
  }
  for (const { local, module } of renames) {
    if (!module) continue;
    for (const draft of drafts) if (draft.name === local) draft.exported = true;
  }
  const tops: TopUse[] = drafts.map((draft) => {
    const scanned =
      draft.scanRoot === null || draft.scanRoot === undefined
        ? { references: [] as string[], calls: [] as CallUse[] }
        : scan(draft.scanRoot, draft.name, draft.at, lineOf, true);
    const references = [...new Set(scanned.references.filter((name) => name !== draft.name))].sort();
    const calls = [...scanned.calls].sort(byLine);
    const entries = entriesOf(draft.entriesInit, draft.name, draft.at, lineOf);
    const base = { name: draft.name, exported: draft.exported, line: draft.line, types: draft.types, references, calls };
    return entries === undefined ? base : { ...base, entries };
  });
  const calls: CallUse[] = [...tops.flatMap((top) => top.calls)];
  for (const { root, at } of stray) calls.push(...scan(root, undefined, at, lineOf, true).calls);
  calls.sort(byLine);
  return { calls, tops };
}

const collectDeclaration = (
  statement: Node,
  script: Script,
  lineOf: Located,
  exported: boolean,
  drafts: {
    name: string;
    line: number;
    at: number;
    scanRoot: unknown;
    entriesInit: unknown;
    types: readonly string[];
    exported: boolean;
  }[],
): void => {
  const isExported = exported && script.module;
  switch (statement.type) {
    case 'VariableDeclaration':
      for (const declarator of nodes(statement.declarations)) {
        const types = typesOfDeclarator(declarator.id, declarator.init);
        for (const { name, start } of patternNames(declarator.id)) {
          drafts.push({
            name,
            line: lineOf(script.at + start),
            at: script.at,
            scanRoot: declarator.init ?? null,
            entriesInit: declarator.init ?? null,
            types,
            exported: isExported,
          });
        }
      }
      break;
    case 'FunctionDeclaration':
    case 'ClassDeclaration': {
      const name = nameOf(statement.id);
      if (name !== undefined)
        drafts.push({
          name,
          line: lineOf(script.at + (node(statement.id)?.start ?? statement.start ?? 0)),
          at: script.at,
          scanRoot: statement,
          entriesInit: null,
          types: [],
          exported: isExported,
        });
      break;
    }
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSEnumDeclaration': {
      const name = nameOf(statement.id);
      if (name !== undefined)
        drafts.push({
          name,
          line: lineOf(script.at + (node(statement.id)?.start ?? statement.start ?? 0)),
          at: script.at,
          scanRoot: statement,
          entriesInit: null,
          types: [],
          exported: isExported,
        });
      break;
    }
    case 'TSModuleDeclaration': {
      const id = node(statement.id);
      if (id?.type === 'Identifier' && typeof id.name === 'string') {
        drafts.push({
          name: id.name,
          line: lineOf(script.at + (id.start ?? statement.start ?? 0)),
          at: script.at,
          scanRoot: statement,
          entriesInit: null,
          types: [],
          exported: isExported,
        });
      }
      break;
    }
    default:
      break;
  }
};

const entriesOf = (init: unknown, owner: string, at: number, lineOf: Located): readonly UsageEntry[] | undefined => {
  const unwrapped = unwrap(init);
  if (unwrapped?.type !== 'ObjectExpression') return undefined;
  const out: UsageEntry[] = [];
  for (const property of nodes(unwrapped.properties)) {
    if (property.type === 'SpreadElement') continue;
    let key: string | undefined;
    if (property.computed === true) {
      const held = node(property.key);
      if (held?.type === 'Literal' && typeof held.value === 'string') key = held.value;
      else continue;
    } else {
      key = nameOf(property.key);
      if (key === undefined) continue;
    }
    const value = property.value;
    const valueUnwrapped = unwrap(value);
    const keys = valueUnwrapped?.type === 'ObjectExpression' ? keysOfObject(valueUnwrapped) : [];
    const properties = valueUnwrapped?.type === 'ObjectExpression' ? propertiesOf(valueUnwrapped, owner, at, lineOf) : undefined;
    const spread = valueUnwrapped?.type === 'ObjectExpression' && hasSpreadOrComputed(valueUnwrapped) ? (true as const) : undefined;
    const scanned = scan(value, owner, at, lineOf, false);
    out.push({
      key,
      line: lineOf(at + (property.start ?? unwrapped.start ?? 0)),
      keys,
      references: [...new Set(scanned.references)].sort(),
      calls: [...scanned.calls].sort(byLine),
      properties,
      spread,
    });
  }
  return out;
};

const propertiesOf = (object: Node, owner: string | undefined, at: number, lineOf: Located): readonly CallProperty[] => {
  const out: CallProperty[] = [];
  for (const property of nodes(object.properties)) {
    if (property.type === 'SpreadElement') continue;
    let key: string | undefined;
    if (property.computed === true) {
      const held = node(property.key);
      if (held?.type === 'Literal' && typeof held.value === 'string') key = held.value;
      else continue;
    } else {
      key = nameOf(property.key);
      if (key === undefined) continue;
    }
    const scanned = scan(property.value, owner, at, lineOf, false);
    out.push({
      key,
      value: valueFormOf(property.value),
      references: [...new Set(scanned.references)].sort(),
      calls: [...scanned.calls].sort(byLine),
    });
  }
  return out;
};

const scan = (
  root: unknown,
  owner: string | undefined,
  at: number,
  lineOf: Located,
  deep: boolean,
): { readonly references: string[]; readonly calls: CallUse[] } => {
  const refs: string[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined): void => {
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      refs.push(name);
    }
  };
  const calls: CallUse[] = [];
  const stack: { readonly value: unknown; readonly parent: Node | undefined; readonly key: string | undefined }[] = [
    { value: root, parent: undefined, key: undefined },
  ];
  while (stack.length > 0) {
    const { value, parent, key } = stack.pop() as {
      readonly value: unknown;
      readonly parent: Node | undefined;
      readonly key: string | undefined;
    };
    if (Array.isArray(value)) {
      for (let at = value.length - 1; at >= 0; at -= 1) stack.push({ value: value[at], parent, key });
      continue;
    }
    const held = node(value);
    if (held === undefined) continue;
    if (parent !== undefined && key !== undefined) {
      if ((key === 'key' || key === 'property') && (parent.computed === undefined || parent.computed !== true)) {
        if (
          parent.type === 'MemberExpression' ||
          parent.type === 'Property' ||
          parent.type === 'PropertyDefinition' ||
          parent.type === 'MethodDefinition' ||
          parent.type === 'TSPropertySignature' ||
          parent.type === 'TSMethodSignature'
        )
          continue;
      }
      if (parent.type === 'TSTypeReference' && key === 'typeName') continue;
      if (
        (parent.type === 'JSXAttribute' && key === 'name') ||
        (parent.type === 'JSXMemberExpression' && key === 'property') ||
        (parent.type === 'ExportSpecifier' && key === 'exported') ||
        (parent.type === 'ImportSpecifier' && key === 'imported')
      )
        continue;
    }
    switch (held.type) {
      case 'MemberExpression':
        if (held.computed !== true) push(written(held));
        break;
      case 'Identifier':
      case 'JSXIdentifier':
        if (typeof held.name === 'string') push(held.name);
        break;
      case 'TSTypeReference':
        push(written(held.typeName));
        break;
      case 'CallExpression':
      case 'NewExpression': {
        const callee = calleeOf(held.callee);
        if (callee !== undefined) {
          push(callee);
          const args = nodes(held.arguments);
          const first = firstOf(args);
          const keys = keysForCall(args);
          const start = held.start ?? 0;
          const line = lineOf(at + start);
          const firstObject = deep ? unwrap(args[0]) : undefined;
          const properties = firstObject?.type === 'ObjectExpression' ? propertiesOf(firstObject, owner, at, lineOf) : undefined;
          const secondObject = unwrap(args[1]);
          const secondProperties = secondObject?.type === 'ObjectExpression' ? propertiesOf(secondObject, owner, at, lineOf) : undefined;
          const secondSpread = secondObject?.type === 'ObjectExpression' && hasSpreadOrComputed(secondObject) ? (true as const) : undefined;
          calls.push({
            callee,
            line,
            offset: at + start,
            kind: held.type === 'NewExpression' ? 'new' : 'call',
            first,
            firstLiteral: first !== undefined && firstLiteralOf(args) ? (true as const) : undefined,
            keys,
            properties,
            secondProperties,
            secondSpread,
            owner,
          });
        }
        break;
      }
      default:
        break;
    }
    for (const child in held) {
      if (child === 'start' || child === 'end') continue;
      const next = held[child];
      if (next !== null && typeof next === 'object') stack.push({ value: next, parent: held, key: child });
    }
  }
  return { references: refs, calls };
};

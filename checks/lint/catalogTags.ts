import type { Context, CreateRule, ESTree, Plugin } from '@oxlint/plugins';
import { matchesGlob, relative, sep } from 'node:path';

type Node = ESTree.Node;

export type Position = 'compare' | 'argument' | 'property' | 'lookup';

type Entry = {
  readonly region: readonly [string, ...string[]];
  readonly words: readonly [string, ...string[]];
  readonly positions: readonly [Position, ...Position[]];
  readonly allowIn: readonly string[];
};

export type Options = {
  readonly base: string;
  readonly files: { readonly extensions: readonly string[]; readonly exclude: readonly string[] };
  readonly uncovered: readonly string[];
  readonly literals: readonly Entry[];
};

export const ruleName = (word: string, position: Position): string => `${position}-${Buffer.from(word, 'utf16le').toString('hex')}`;

const covered = (patterns: readonly string[], path: string): boolean => patterns.some((pattern) => matchesGlob(path, pattern));
const inside = (entry: string, path: string): boolean => {
  const at = entry.replace(/\/+$/, '');
  return at === '' || path === at || path.startsWith(`${at}/`);
};
const equality = new Set(['===', '!==', '==', '!=']);
const lookups = new Set(['get', 'has']);

const nameOf = (node: Node | null | undefined): string | undefined => {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
};

const taggish = (name: string | undefined): boolean => {
  if (name === undefined) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '');
  return words.some((word) => /^tags?$/i.test(word)) && /^(?:tags?|ids?)$/i.test(words.at(-1) ?? '');
};

type Callable = ESTree.Function | ESTree.ArrowFunctionExpression;
const parameterNames = (fn: Callable): readonly (string | undefined)[] =>
  fn.params.map((param) => {
    const inner = param.type === 'TSParameterProperty' ? param.parameter : param;
    return nameOf(inner.type === 'AssignmentPattern' ? inner.left : inner);
  });

const readLiterals = (context: Context, program: ESTree.Program, options: Options): ReadonlyMap<string, readonly Node[]> => {
  const groups = new Map<string, Node[]>();
  const file = relative(context.cwd, context.physicalFilename).split(sep).join('/');
  const prefix = options.base === '' ? '' : `${options.base}/`;
  if (!file.startsWith(prefix)) return groups;
  const local = file.slice(prefix.length);
  if (
    !options.files.extensions.some((extension) => local.endsWith(extension)) ||
    covered(options.files.exclude, local) ||
    options.uncovered.some((entry) => inside(entry, file))
  )
    return groups;
  const entries = options.literals.filter((entry) => covered(entry.region, local) && !covered(entry.allowIn, local));
  if (entries.length === 0 || !/tag/i.test(context.sourceCode.text)) return groups;
  const allowed = new Map<string, Map<Position, string>>();
  for (const entry of entries)
    for (const word of entry.words) {
      const held = allowed.get(word) ?? new Map<Position, string>();
      for (const position of entry.positions) held.set(position, ruleName(word, position));
      allowed.set(word, held);
    }
  const parenthesized = (node: Node): boolean => {
    const before = context.sourceCode.getTokenBefore(node);
    if (before?.value !== '(') return false;
    const after = context.sourceCode.getTokenAfter(node);
    if (after?.value !== ')') return false;
    const parent = context.sourceCode.getAncestors(node).at(-1) as Node | undefined;
    return !(
      parent?.type === 'CallExpression' &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === node &&
      after.range[1] === parent.range[1]
    );
  };
  const stringOf = (node: Node | null | undefined): string | undefined => {
    if (node === null || node === undefined) return undefined;
    if (node.type === 'Literal' && typeof node.value === 'string') return parenthesized(node) ? undefined : node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
      return parenthesized(node) ? undefined : (node.quasis[0]?.value.cooked ?? undefined);
    return undefined;
  };
  const tail = (node: Node | null | undefined): string | undefined => {
    switch (node?.type) {
      case 'Identifier':
        return node.name;
      case 'MemberExpression':
        return node.computed ? stringOf(node.property) : nameOf(node.property);
      case 'CallExpression':
        return tail(node.callee);
      case 'ChainExpression':
      case 'TSNonNullExpression':
      case 'ParenthesizedExpression':
        return tail(node.expression);
      default:
        return undefined;
    }
  };
  const callableOf = (node: Node | null | undefined): Callable | undefined => {
    if (node === null || node === undefined || parenthesized(node)) return undefined;
    if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return node;
    if (node.type === 'CallExpression')
      return node.arguments.find(
        (arg): arg is Callable => (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') && !parenthesized(arg),
      );
    return undefined;
  };
  const literal = (node: Node | null | undefined, position: Position, near: string | undefined) => {
    const word = stringOf(node);
    if (node === undefined || node === null || word === undefined || near === undefined) return;
    const key = allowed.get(word)?.get(position);
    if (key === undefined) return;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, [node]);
    else held.push(node);
  };
  const literals = (nodes: readonly (Node | null)[], position: Position, near: string | undefined) => {
    for (const node of nodes) {
      if (node?.type === 'ArrayExpression' && !parenthesized(node)) for (const element of node.elements) literal(element, position, near);
      else literal(node, position, near);
    }
  };
  const callables = new Map<string, (readonly (string | undefined)[])[]>();
  const callable = (name: string | undefined, fn: Callable | undefined) => {
    if (name === undefined || fn === undefined) return;
    const held = callables.get(name);
    if (held === undefined) callables.set(name, [parameterNames(fn)]);
    else held.push(parameterNames(fn));
  };
  const pending: { callee: string; args: readonly Node[] }[] = [];
  const stack: Node[] = [program];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.type) {
      case 'BinaryExpression': {
        if (!equality.has(node.operator)) break;
        const left = tail(node.left),
          right = tail(node.right);
        if (taggish(right)) literal(node.left, 'compare', right);
        if (taggish(left)) literal(node.right, 'compare', left);
        break;
      }
      case 'SwitchStatement': {
        const near = tail(node.discriminant);
        if (taggish(near)) for (const branch of node.cases) literal(branch.test, 'compare', near);
        break;
      }
      case 'CallExpression': {
        const callee = node.callee;
        const member = callee.type === 'MemberExpression' && !parenthesized(callee) ? callee : undefined;
        const object = member === undefined ? undefined : tail(member.object);
        const name = tail(callee);
        if (member !== undefined && lookups.has(name ?? '') && taggish(object)) literals(node.arguments, 'lookup', object);
        else if (taggish(name)) literals(node.arguments, 'argument', name);
        else if (taggish(object)) literals(node.arguments, 'argument', object);
        else if (callee.type === 'Identifier' && name !== undefined && !parenthesized(callee))
          pending.push({ callee: name, args: node.arguments });
        break;
      }
      case 'MemberExpression':
        if (node.computed && taggish(tail(node.object))) literal(node.property, 'lookup', tail(node.object));
        break;
      case 'Property':
        if (!node.computed && taggish(nameOf(node.key))) literals([node.value], 'property', nameOf(node.key));
        break;
      case 'FunctionDeclaration':
        callable(nameOf(node.id), node);
        break;
      case 'VariableDeclarator':
        callable(nameOf(node.id), callableOf(node.init));
        break;
    }
    const fields = node as unknown as Record<string, Node | readonly Node[] | null>;
    for (const key of context.sourceCode.visitorKeys[node.type] ?? []) {
      const child = fields[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item !== null) stack.push(item);
      } else if (child !== null && child !== undefined) stack.push(child as Node);
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
  return groups;
};

export const catalogPlugin = (options: Options): Plugin => {
  const readings = new WeakMap<ESTree.Program, ReadonlyMap<string, readonly Node[]>>();
  const rules: Record<string, CreateRule> = {};
  for (const entry of options.literals)
    for (const word of entry.words)
      for (const position of entry.positions) {
        const key = ruleName(word, position);
        if (rules[key] !== undefined) continue;
        rules[key] = {
          meta: { type: 'problem', schema: [] },
          create(context) {
            return {
              Program(program) {
                let reading = readings.get(program);
                if (reading === undefined) {
                  reading = readLiterals(context, program, options);
                  readings.set(program, reading);
                }
                for (const node of reading.get(key) ?? [])
                  context.report({ node, message: `Catalog tag '${word}' in a ${position} position.` });
              },
            };
          },
        };
      }
  return { meta: { name: 'runlith-catalog-tags' }, rules };
};

import { parse } from 'svelte/compiler';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import { scriptsOf } from '@runlith/code-facts/adapters';
import { failureOf, parsedNow } from '@runlith/code-facts/js/imports';

type Node = { readonly type: string; readonly start: number; readonly end: number; readonly [key: string]: unknown };

export type Use = { readonly name: string; readonly offset: number };

export type Uses = { readonly globals: readonly Use[]; readonly imports: readonly Use[] };

type Scope = { readonly names: Set<string>; readonly parent: Scope | undefined };

const ROOTS = new Set(['window', 'globalThis', 'self']);

const WRAPPERS = new Set([
  'ParenthesizedExpression',
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

const SKIPPED = new Set(['type', 'start', 'end', 'loc', 'range', 'metadata', 'comments', 'leadingComments', 'trailingComments', 'parent']);

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

const childOf = (node: Node, key: string): Node | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};

const childrenOf = (node: Node, key: string): readonly Node[] => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};

const unwrapped = (node: Node | undefined): Node | undefined => {
  let at = node;
  while (at !== undefined && WRAPPERS.has(at.type)) at = childOf(at, 'expression');
  return at;
};

const identifier = (node: Node | undefined): string | undefined =>
  node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : undefined;

const text = (node: Node | undefined): string | undefined =>
  (node?.type === 'Literal' || node?.type === 'StringLiteral') && typeof node.value === 'string' ? node.value : undefined;

const scopeIn = (parent: Scope | undefined): Scope => ({ names: new Set(), parent });

const bound = (scope: Scope, name: string): boolean => {
  for (let at: Scope | undefined = scope; at !== undefined; at = at.parent) if (at.names.has(name)) return true;
  return false;
};

const namesOf = (pattern: Node | undefined): readonly string[] => {
  switch (pattern?.type) {
    case undefined:
      return [];
    case 'Identifier':
      return [identifier(pattern)!];
    case 'AssignmentPattern':
      return namesOf(childOf(pattern, 'left'));
    case 'RestElement':
      return namesOf(childOf(pattern, 'argument'));
    case 'TSParameterProperty':
      return namesOf(childOf(pattern, 'parameter'));
    case 'ArrayPattern':
      return childrenOf(pattern, 'elements').flatMap(namesOf);
    case 'ObjectPattern':
      return childrenOf(pattern, 'properties').flatMap((one) =>
        namesOf(one.type === 'RestElement' ? childOf(one, 'argument') : childOf(one, 'value')),
      );
    default:
      return [];
  }
};

const declared = (statement: Node): readonly string[] => {
  const inner =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? childOf(statement, 'declaration')
      : statement;
  switch (inner?.type) {
    case 'VariableDeclaration':
      return childrenOf(inner, 'declarations').flatMap((one) => namesOf(childOf(one, 'id')));
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
    case 'TSEnumDeclaration':
    case 'TSImportEqualsDeclaration': {
      const name = identifier(childOf(inner, 'id'));
      return name === undefined ? [] : [name];
    }
    case 'ImportDeclaration':
      return inner.importKind === 'type'
        ? []
        : childrenOf(inner, 'specifiers').flatMap((one) => (one.importKind === 'type' ? [] : namesOf(childOf(one, 'local'))));
    default:
      return [];
  }
};

const varsIn = (node: Node): readonly string[] => {
  if (FUNCTIONS.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return [];
  const own = node.type === 'VariableDeclaration' && node.kind === 'var' ? declared(node) : [];
  const nested = Object.keys(node).flatMap((key) => {
    if (SKIPPED.has(key)) return [];
    const value = node[key];
    if (Array.isArray(value)) return value.filter(isNode).flatMap(varsIn);
    return isNode(value) ? varsIn(value) : [];
  });
  return [...own, ...nested];
};

const memberName = (node: Node): string | undefined =>
  node.computed === true ? text(unwrapped(childOf(node, 'property'))) : identifier(childOf(node, 'property'));

const pathOf = (raw: Node | undefined, scope: Scope): readonly string[] | undefined => {
  const node = unwrapped(raw);
  const name = identifier(node);
  if (name !== undefined) return bound(scope, name) ? undefined : [name];
  if (node?.type !== 'MemberExpression') return undefined;
  const member = memberName(node);
  const object = member === undefined ? undefined : pathOf(childOf(node, 'object'), scope);
  return object === undefined ? undefined : [...object, member!];
};

const normalized = (path: readonly string[]): readonly string[] => {
  let at = path;
  while (at.length > 1 && ROOTS.has(at[0]!)) at = at.slice(1);
  return at;
};

const enumMembersOf = (node: Node): readonly Node[] => {
  const body = childOf(node, 'body');
  return body === undefined ? childrenOf(node, 'members') : childrenOf(body, 'members');
};

const letNamesOf = (expression: Node | undefined): readonly string[] => {
  switch (expression?.type) {
    case 'Identifier':
      return [identifier(expression)!];
    case 'AssignmentExpression':
      return letNamesOf(childOf(expression, 'left'));
    case 'SpreadElement':
      return letNamesOf(childOf(expression, 'argument'));
    case 'ArrayExpression':
      return childrenOf(expression, 'elements').flatMap(letNamesOf);
    case 'ObjectExpression':
      return childrenOf(expression, 'properties').flatMap((one) =>
        letNamesOf(one.type === 'SpreadElement' ? childOf(one, 'argument') : childOf(one, 'value')),
      );
    default:
      return namesOf(expression);
  }
};

const keyOf = (property: Node): string | undefined =>
  property.computed === true ? text(unwrapped(childOf(property, 'key'))) : identifier(childOf(property, 'key'));

const typeOnly = (node: Node): boolean => {
  const specifiers = childrenOf(node, 'specifiers');
  return node.importKind === 'type' || (specifiers.length > 0 && specifiers.every((one) => one.importKind === 'type'));
};

export const usesOf = (path: string, source: string): Uses => {
  const globals: Use[] = [];
  const imports: Use[] = [];
  let shift = 0;
  const read = (named: readonly string[], offset: number): boolean => {
    if (named.length > 2) return false;
    globals.push({ name: named.join('.'), offset: shift + offset });
    return true;
  };
  const imported = (node: Node | undefined, offset: number): void => {
    const specifier = text(node);
    if (specifier !== undefined) imports.push({ name: specifier, offset: shift + offset });
  };

  const destructured = (pattern: Node | undefined, init: Node | undefined, scope: Scope, offset: number): void => {
    const path = pattern?.type === 'ObjectPattern' ? pathOf(init, scope) : undefined;
    if (path === undefined) return;
    for (const property of childrenOf(pattern!, 'properties')) {
      const key = property.type === 'Property' ? keyOf(property) : undefined;
      if (key !== undefined) read(normalized([...path, key]), offset);
    }
  };

  const declare = (statements: readonly Node[], scope: Scope): void => {
    for (const statement of statements) for (const name of declared(statement)) scope.names.add(name);
  };

  const visitAll = (nodes: readonly Node[], scope: Scope): void => {
    for (const one of nodes) visit(one, scope);
  };

  const visitPattern = (pattern: Node | undefined, scope: Scope): void => {
    switch (pattern?.type) {
      case undefined:
      case 'Identifier':
        return;
      case 'AssignmentPattern':
        visitPattern(childOf(pattern, 'left'), scope);
        visit(childOf(pattern, 'right'), scope);
        return;
      case 'RestElement':
        visitPattern(childOf(pattern, 'argument'), scope);
        return;
      case 'TSParameterProperty':
        visitPattern(childOf(pattern, 'parameter'), scope);
        return;
      case 'ArrayPattern':
        for (const one of childrenOf(pattern, 'elements')) visitPattern(one, scope);
        return;
      case 'ObjectPattern':
        for (const one of childrenOf(pattern, 'properties')) {
          if (one.type === 'RestElement') visitPattern(childOf(one, 'argument'), scope);
          else {
            if (one.computed === true) visit(childOf(one, 'key'), scope);
            visitPattern(childOf(one, 'value'), scope);
          }
        }
        return;
      default:
        visit(pattern, scope);
    }
  };

  const visitBody = (statements: readonly Node[], scope: Scope, hoisting?: Node): void => {
    declare(statements, scope);
    if (hoisting !== undefined) for (const name of varsIn(hoisting)) scope.names.add(name);
    visitAll(statements, scope);
  };

  const visitFunction = (node: Node, scope: Scope): void => {
    const inner = scopeIn(scope);
    const own = identifier(childOf(node, 'id'));
    if (own !== undefined) inner.names.add(own);
    const params = childrenOf(node, 'params');
    for (const param of params) for (const name of namesOf(param)) inner.names.add(name);
    for (const param of params) visitPattern(param, inner);
    const body = childOf(node, 'body');
    if (body?.type === 'BlockStatement') visitBody(childrenOf(body, 'body'), inner, body);
    else visit(body, inner);
  };

  const visitFragment = (fragment: Node | undefined, scope: Scope): void => {
    if (fragment === undefined) return;
    const inner = scopeIn(scope);
    for (const node of childrenOf(fragment, 'nodes')) {
      if (node.type === 'SnippetBlock') {
        const name = identifier(childOf(node, 'expression'));
        if (name !== undefined) inner.names.add(name);
      }
      if (node.type === 'ConstTag') declare([childOf(node, 'declaration')!], inner);
    }
    visitAll(childrenOf(fragment, 'nodes'), inner);
  };

  const visitBlock = (patterns: readonly (Node | undefined)[], body: Node | undefined, scope: Scope): void => {
    const inner = scopeIn(scope);
    for (const name of patterns.flatMap(namesOf)) inner.names.add(name);
    for (const one of patterns) visitPattern(one, inner);
    visit(body, inner);
  };

  const visitChildren = (node: Node, scope: Scope): void => {
    for (const key of Object.keys(node)) {
      if (SKIPPED.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) visitAll(value.filter(isNode), scope);
      else if (isNode(value)) visit(value, scope);
    }
  };

  const visit = (node: Node | undefined, scope: Scope): void => {
    if (node === undefined) return;
    switch (node.type) {
      case 'BlockStatement':
        visitBody(childrenOf(node, 'body'), scopeIn(scope));
        return;
      case 'StaticBlock':
        visitBody(childrenOf(node, 'body'), scopeIn(scope), node);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        visitFunction(node, scope);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const inner = scopeIn(scope);
        const own = identifier(childOf(node, 'id'));
        if (own !== undefined) inner.names.add(own);
        visit(childOf(node, 'superClass'), scope);
        visitAll(childrenOf(node, 'decorators'), scope);
        visit(childOf(node, 'body'), inner);
        return;
      }
      case 'Property':
      case 'MethodDefinition':
      case 'PropertyDefinition':
      case 'AccessorProperty':
        if (node.computed === true) visit(childOf(node, 'key'), scope);
        visitAll(childrenOf(node, 'decorators'), scope);
        visit(childOf(node, 'value'), scope);
        return;
      case 'VariableDeclaration':
        for (const one of childrenOf(node, 'declarations')) {
          visitPattern(childOf(one, 'id'), scope);
          visit(childOf(one, 'init'), scope);
          destructured(childOf(one, 'id'), childOf(one, 'init'), scope, one.start);
        }
        return;
      case 'CatchClause':
        visitBlock([childOf(node, 'param')], childOf(node, 'body'), scope);
        return;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const inner = scopeIn(scope);
        const head = childOf(node, node.type === 'ForStatement' ? 'init' : 'left');
        if (head !== undefined) declare([head], inner);
        visitChildren(node, inner);
        return;
      }
      case 'SwitchStatement': {
        visit(childOf(node, 'discriminant'), scope);
        const inner = scopeIn(scope);
        for (const one of childrenOf(node, 'cases')) declare(childrenOf(one, 'consequent'), inner);
        visitAll(childrenOf(node, 'cases'), inner);
        return;
      }
      case 'Identifier': {
        const name = identifier(node)!;
        if (!bound(scope, name)) read([name], node.start);
        return;
      }
      case 'MemberExpression': {
        const path = pathOf(node, scope);
        if (path !== undefined && read(normalized(path), node.start)) return;
        visit(childOf(node, 'object'), scope);
        if (node.computed === true) visit(childOf(node, 'property'), scope);
        return;
      }
      case 'BinaryExpression': {
        const member = node.operator === 'in' ? text(unwrapped(childOf(node, 'left'))) : undefined;
        const path = member === undefined ? undefined : pathOf(childOf(node, 'right'), scope);
        if (path !== undefined && read(normalized([...path, member!]), node.start)) return;
        visitChildren(node, scope);
        return;
      }
      case 'LabeledStatement':
        visit(childOf(node, 'body'), scope);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return;
      case 'TSImportEqualsDeclaration': {
        const reference = childOf(node, 'moduleReference');
        if (node.importKind !== 'type' && reference?.type === 'TSExternalModuleReference')
          imported(childOf(reference, 'expression'), node.start);
        return;
      }
      case 'TSEnumDeclaration':
        if (node.declare !== true)
          visitAll(
            enumMembersOf(node).flatMap((one) => childOf(one, 'initializer') ?? []),
            scope,
          );
        return;
      case 'TSModuleDeclaration': {
        const body = childOf(node, 'body');
        if (node.declare !== true && body?.type === 'TSModuleBlock') visitBody(childrenOf(body, 'body'), scopeIn(scope), body);
        else if (node.declare !== true && body?.type === 'TSModuleDeclaration') visit(body, scope);
        return;
      }
      case 'ImportDeclaration':
        if (!typeOnly(node)) imported(childOf(node, 'source'), node.start);
        return;
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        if (node.exportKind !== 'type') imported(childOf(node, 'source'), node.start);
        visit(childOf(node, 'declaration'), scope);
        return;
      case 'ImportExpression':
        imported(unwrapped(childOf(node, 'source')), node.start);
        visitChildren(node, scope);
        return;
      case 'TSParameterProperty':
        visitPattern(node, scope);
        return;
      case 'Fragment':
        visitFragment(node, scope);
        return;
      case 'EachBlock': {
        visit(childOf(node, 'expression'), scope);
        const context = childOf(node, 'context');
        const inner = scopeIn(scope);
        for (const name of namesOf(context)) inner.names.add(name);
        if (typeof node.index === 'string') inner.names.add(node.index);
        visitPattern(context, inner);
        visit(childOf(node, 'key'), inner);
        visit(childOf(node, 'body'), inner);
        visit(childOf(node, 'fallback'), scope);
        return;
      }
      case 'AwaitBlock':
        visit(childOf(node, 'expression'), scope);
        visit(childOf(node, 'pending'), scope);
        visitBlock([childOf(node, 'value')], childOf(node, 'then'), scope);
        visitBlock([childOf(node, 'error')], childOf(node, 'catch'), scope);
        return;
      case 'SnippetBlock':
        visitBlock(childrenOf(node, 'parameters'), childOf(node, 'body'), scope);
        return;
      case 'ConstTag':
        visit(childOf(node, 'declaration'), scope);
        return;
      default:
        if (node.type.startsWith('TS')) {
          if (WRAPPERS.has(node.type)) visit(childOf(node, 'expression'), scope);
          return;
        }
        if (childrenOf(node, 'attributes').some((one) => one.type === 'LetDirective')) {
          const inner = scopeIn(scope);
          for (const one of childrenOf(node, 'attributes')) {
            if (one.type !== 'LetDirective') continue;
            const names = childOf(one, 'expression') === undefined ? [String(one.name)] : letNamesOf(childOf(one, 'expression'));
            for (const name of names) inner.names.add(name);
          }
          visitAll(
            childrenOf(node, 'attributes').filter((one) => one.type !== 'LetDirective'),
            scope,
          );
          visit(childOf(node, 'fragment'), inner);
          return;
        }
        visitChildren(node, scope);
    }
  };

  if (path.endsWith('.svelte')) {
    let root: Node;
    try {
      root = parse(source, { modern: true }) as unknown as Node;
    } catch (error) {
      throw new UnsupportedSource(path, `does not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
    let scope = scopeIn(undefined);
    for (const script of [childOf(root, 'module'), childOf(root, 'instance')]) {
      const program = script === undefined ? undefined : childOf(script, 'content');
      if (program === undefined) continue;
      scope = scopeIn(scope);
      visitBody(childrenOf(program, 'body'), scope, program);
    }
    visitFragment(childOf(root, 'fragment'), scope);
  } else {
    for (const script of scriptsOf(source, path)) {
      const parsed = parsedNow(path, script);
      const failure = failureOf(parsed);
      if (failure !== undefined) throw new UnsupportedSource(path, `does not parse: ${failure.message}`);
      const program = parsed.program as unknown as Node;
      shift = script.at;
      visitBody(childrenOf(program, 'body'), scopeIn(undefined), program);
    }
  }
  return { globals, imports };
};

export type Node = { readonly type: string; readonly start: number; readonly end: number; readonly [key: string]: unknown };

export const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

export const childOf = (node: Node, key: string): Node | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};

export const childrenOf = (node: Node, key: string): readonly Node[] => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};

const WRAPPERS = new Set([
  'ParenthesizedExpression',
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

export const unwrapped = (node: Node | undefined): Node | undefined => {
  let at = node;
  while (at !== undefined && WRAPPERS.has(at.type)) at = childOf(at, 'expression');
  return at;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export const nameOf = (node: Node | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string' && IDENTIFIER.test(node.value))
    return node.value;
  return undefined;
};

export const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

export type Reader = {
  readonly member: (node: Node | undefined, module?: string) => string | undefined;
  readonly piped: (node: Node) => boolean;
};

export const readerOf = (programs: readonly Node[]): Reader => {
  const modules = new Map<string, string>();
  const roots = new Set<string>();
  const pipe = new Set<string>();
  for (const program of programs) {
    for (const statement of childrenOf(program, 'body')) {
      if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
      const source = childOf(statement, 'source')?.value;
      for (const specifier of childrenOf(statement, 'specifiers')) {
        if (specifier.importKind === 'type') continue;
        const local = nameOf(childOf(specifier, 'local'));
        if (local === undefined) continue;
        const imported = specifier.type === 'ImportSpecifier' ? nameOf(childOf(specifier, 'imported')) : undefined;
        if (source === 'effect' && imported !== undefined) modules.set(local, imported);
        else if (source === 'effect' && specifier.type === 'ImportNamespaceSpecifier') roots.add(local);
        else if (typeof source === 'string' && source.startsWith('effect/') && specifier.type !== 'ImportSpecifier')
          modules.set(local, source.slice(7));
        if ((source === 'effect' || source === 'effect/Function') && imported === 'pipe') pipe.add(local);
      }
    }
  }
  const members = new WeakMap<Node, { readonly module: string; readonly name: string } | null>();
  const resolve = (node: Node) => {
    if (node.type !== 'MemberExpression' || node.computed === true) return null;
    const object = unwrapped(childOf(node, 'object'));
    const name = nameOf(childOf(node, 'property'));
    if (name === undefined) return null;
    if (object?.type === 'Identifier') {
      const module = modules.get(nameOf(object) ?? '');
      return module === undefined ? null : { module, name };
    }
    if (object?.type !== 'MemberExpression' || object.computed === true) return null;
    const root = unwrapped(childOf(object, 'object'));
    const module = nameOf(childOf(object, 'property'));
    return root?.type === 'Identifier' && roots.has(nameOf(root) ?? '') && module !== undefined ? { module, name } : null;
  };
  return {
    member: (raw, module = 'Effect') => {
      const node = unwrapped(raw);
      if (node === undefined) return undefined;
      let held = members.get(node);
      if (held === undefined) {
        held = resolve(node);
        members.set(node, held);
      }
      return held?.module === module ? held.name : undefined;
    },
    piped: (node) => node.type === 'Identifier' && pipe.has(nameOf(node) ?? ''),
  };
};

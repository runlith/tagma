import type { Tree } from '@runlith/code-facts/tree';
import { parseSync } from 'oxc-parser';
import { posix } from 'node:path';

type Node = { readonly type: string; readonly [key: string]: unknown };
export type Literal = boolean | number | string;

const LANGS: Readonly<Record<string, 'ts' | 'tsx' | 'js' | 'jsx'>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
};

const node = (value: unknown): Node | undefined =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' ? (value as Node) : undefined;

const literalOf = (value: unknown): { readonly value: unknown } | undefined => {
  const held = node(value);
  if (held === undefined) return undefined;
  if (held.type === 'TSAsExpression' || held.type === 'TSSatisfiesExpression' || held.type === 'ParenthesizedExpression')
    return literalOf(held.expression);
  return held.type === 'Literal' ? { value: held.value } : undefined;
};

const initOf = (declaration: Node | undefined, name: string): { readonly found: true; readonly init: unknown } | undefined => {
  if (declaration?.type !== 'VariableDeclaration' || !Array.isArray(declaration.declarations)) return undefined;
  for (const one of declaration.declarations) {
    const binding = node(one);
    const id = node(binding?.id);
    if (id?.type === 'Identifier' && id.name === name) return { found: true, init: binding?.init };
  }
  return undefined;
};

export function optionOf(tree: Tree, file: string, name: string, off: readonly Literal[]): boolean | undefined {
  if (!tree.has(file)) return undefined;
  const parsed = parseSync(file, tree.read(file), { lang: LANGS[posix.extname(file)] ?? 'js', sourceType: 'module' });
  if (parsed.errors.some((error) => error.severity === 'Error')) return true;
  const body = parsed.program.body as unknown as readonly Node[];
  const decide = (init: unknown): boolean => {
    const literal = literalOf(init);
    return literal === undefined || !off.includes(literal.value as Literal);
  };
  for (const statement of body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const direct = initOf(node(statement.declaration), name);
    if (direct !== undefined) return decide(direct.init);
    if (statement.source !== null && statement.source !== undefined) continue;
    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      const exported = node(node(specifier)?.exported);
      const local = node(node(specifier)?.local);
      const exportedName = exported?.type === 'Literal' ? exported.value : exported?.name;
      if (exportedName !== name || typeof local?.name !== 'string') continue;
      for (const one of body) {
        const bound = initOf(one.type === 'ExportNamedDeclaration' ? node(one.declaration) : one, local.name);
        if (bound !== undefined) return decide(bound.init);
      }
      return true;
    }
  }
  return undefined;
}

import type { UseKind } from '@runlith/navigation/verdict';
import {
  type Declaration,
  type Identifier,
  type Node,
  type PrivateIdentifier,
  type SourceFile,
  type StringLiteral,
  SyntaxKind as K,
  computeLineStarts,
  getNameOfDeclaration,
  getTouchingPropertyName,
  isIdentifier,
  isPrivateIdentifier,
  isSourceFile,
} from 'typescript7/ast';

export type Name = Identifier | PrivateIdentifier | StringLiteral;

export type Spotted = { readonly _tag: 'name'; readonly node: Name } | { readonly _tag: 'text' } | { readonly _tag: 'moved' };

const starts = new WeakMap<SourceFile, readonly number[]>();

export const lineStarts = (source: SourceFile): readonly number[] => {
  let found = starts.get(source);
  if (found === undefined) {
    found = computeLineStarts(source.text);
    starts.set(source, found);
  }
  return found;
};

export const offsetOf = (source: SourceFile, line: number, column: number): number | undefined => {
  const start = lineStarts(source)[line - 1];
  return start === undefined ? undefined : start + column - 1;
};

export const placeOf = (source: SourceFile, offset: number) => {
  const all = lineStarts(source);
  let low = 0;
  let high = all.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((all[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  const start = all[low] ?? 0;
  const text = source.text.slice(start, all[low + 1] ?? source.text.length).replace(/\r?\n$/, '');
  return { line: low + 1, column: offset - start + 1, text };
};

const quoted = (node: Node): boolean => {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (parent.kind === K.ElementAccessExpression) return (parent as Node & { argumentExpression: Node }).argumentExpression === node;
  if (parent.kind === K.LiteralType) return parent.parent?.kind === K.IndexedAccessType;
  return MEMBERS.has(parent.kind) && getNameOfDeclaration(parent as Declaration) === node;
};

export const spotAt = (source: SourceFile, offset: number, name: string): Spotted => {
  if (source.text.slice(offset, offset + name.length) !== name) return { _tag: 'moved' };
  const node = getTouchingPropertyName(source, offset);
  if ((isIdentifier(node) || isPrivateIdentifier(node)) && node.getStart(source) === offset && node.text === name)
    return { _tag: 'name', node };
  if (
    (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral) &&
    (node as StringLiteral).text === name &&
    node.getStart(source) + 1 === offset &&
    quoted(node)
  )
    return { _tag: 'name', node: node as StringLiteral };
  return { _tag: 'text' };
};

export const MEMBERS = new Set<K>([
  K.PropertyAssignment,
  K.ShorthandPropertyAssignment,
  K.MethodDeclaration,
  K.PropertyDeclaration,
  K.PropertySignature,
  K.MethodSignature,
  K.GetAccessor,
  K.SetAccessor,
]);

const IMPORTS = new Set<K>([
  K.ImportSpecifier,
  K.ImportClause,
  K.NamespaceImport,
  K.ExportSpecifier,
  K.ImportDeclaration,
  K.ExportDeclaration,
  K.ImportEqualsDeclaration,
  K.NamespaceExport,
]);

const WRAPPERS = new Set<K>([
  K.ParenthesizedExpression,
  K.AsExpression,
  K.SatisfiesExpression,
  K.NonNullExpression,
  K.TypeAssertionExpression,
]);

const CALLS = new Set<K>([K.CallExpression, K.NewExpression, K.TaggedTemplateExpression, K.Decorator]);

const isType = (kind: K): boolean =>
  (kind >= K.FirstTypeNode && kind <= K.LastTypeNode) || kind === K.ExpressionWithTypeArguments || kind === K.HeritageClause;

const BOUNDARIES = new Set<K>([
  K.Block,
  K.SourceFile,
  K.ArrowFunction,
  K.FunctionExpression,
  K.FunctionDeclaration,
  K.MethodDeclaration,
  K.ObjectLiteralExpression,
  K.CallExpression,
  K.VariableDeclaration,
  K.ExpressionStatement,
  K.ReturnStatement,
]);

export const unwrap = (node: Node): Node => {
  let at = node;
  while (at.parent !== undefined && WRAPPERS.has(at.parent.kind)) at = at.parent;
  return at;
};

export const isMemberName = (node: Node): boolean =>
  node.parent !== undefined && MEMBERS.has(node.parent.kind) && getNameOfDeclaration(node.parent as Declaration) === node;

export const inImport = (node: Node): boolean => {
  for (let at = node.parent; at !== undefined && !isSourceFile(at); at = at.parent) {
    if (IMPORTS.has(at.kind)) return true;
    if (at.kind >= K.FirstStatement && at.kind <= K.LastStatement) return false;
  }
  return false;
};

export const accessOf = (node: Node): Node => {
  const parent = node.parent;
  if (parent?.kind === K.PropertyAccessExpression && (parent as Node & { name: Node }).name === node) return unwrap(parent);
  if (parent?.kind === K.ElementAccessExpression && (parent as Node & { argumentExpression: Node }).argumentExpression === node)
    return unwrap(parent);
  if (parent?.kind === K.LiteralType) return parent;
  return unwrap(node);
};

const called = (value: Node): boolean => {
  const holder = value.parent;
  if (holder === undefined || !CALLS.has(holder.kind)) return false;
  const callee = holder as Node & { expression?: Node; tag?: Node };
  return callee.expression === value || callee.tag === value;
};

const typed = (node: Node): boolean => {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (isType(at.kind)) return true;
    if (BOUNDARIES.has(at.kind)) return false;
  }
  return false;
};

export const useOf = (node: Node): UseKind => {
  if (inImport(node)) return 'import';
  if (isMemberName(node))
    return node.parent.kind === K.PropertySignature || node.parent.kind === K.MethodSignature ? 'type' : 'implementation';
  if (called(accessOf(node))) return 'call';
  if (typed(node)) return 'type';
  return 'value';
};

const textOf = (node: Node, source: SourceFile): string | undefined => {
  if (isIdentifier(node) || isPrivateIdentifier(node)) return node.text;
  if (node.kind === K.StringLiteral) return (node as StringLiteral).text;
  return source.text.slice(node.getStart(source), node.end) || undefined;
};

const FUNCTIONS = new Set<K>([
  K.FunctionDeclaration,
  K.FunctionExpression,
  K.ArrowFunction,
  K.MethodDeclaration,
  K.GetAccessor,
  K.SetAccessor,
  K.ClassDeclaration,
  K.ClassExpression,
  K.ModuleDeclaration,
]);

const HOLDERS = new Set<K>([K.VariableDeclaration, K.PropertyAssignment, K.PropertyDeclaration]);

const holderName = (fn: Node, source: SourceFile): string | undefined => {
  let at = fn.parent;
  while (at !== undefined && (at.kind === K.CallExpression || WRAPPERS.has(at.kind))) at = at.parent;
  if (at === undefined || !HOLDERS.has(at.kind)) return undefined;
  const name = getNameOfDeclaration(at as Declaration);
  return name !== undefined && isIdentifier(name) ? textOf(name, source) : undefined;
};

export const within = (node: Node, source: SourceFile): string | null => {
  const names: string[] = [];
  for (let at = node.parent; at !== undefined && !isSourceFile(at); at = at.parent) {
    if (at.kind === K.Constructor) {
      names.unshift('constructor');
      continue;
    }
    if (!FUNCTIONS.has(at.kind)) continue;
    const own = getNameOfDeclaration(at as Declaration);
    const name = own === undefined ? holderName(at, source) : textOf(own, source);
    if (name !== undefined) names.unshift(name);
  }
  return names.length === 0 ? null : names.join('.');
};

export const declarationOf = (node: Node): Node | undefined => {
  const parent = node.parent;
  if (parent === undefined) return undefined;
  return getNameOfDeclaration(parent as Declaration) === node ? parent : undefined;
};

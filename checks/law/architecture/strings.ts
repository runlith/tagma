import ts from 'typescript';
import { matchesGlob } from 'node:path';
import type { Finding } from '@runlith/tagma/rules';
import type { VendorParams } from './inspections';
import { within, type Snapshot } from './snapshot';

const literal = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const key = (node: ts.PropertyName): string => (ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : '');
const unwrapped = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)
    ? unwrapped(node.expression)
    : node;
const annotated = (node: ts.Expression): ts.TypeNode | undefined =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)
    ? node.type
    : ts.isParenthesizedExpression(node)
      ? annotated(node.expression)
      : undefined;

export const vendorWords = (snapshot: Snapshot): readonly string[] => {
  const words = new Set<string>();
  for (const path of snapshot.paths) {
    const member = /^packages\/adapter-([^/]+)\//.exec(path);
    if (member === null) continue;
    const file = snapshot.file(path);
    const values = new Map<string, string>();
    const descriptions = new Set(['ProviderDescription']);
    for (const statement of file.statements)
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(statement.importClause.namedBindings)
      )
        for (const binding of statement.importClause.namedBindings.elements)
          if ((binding.propertyName ?? binding.name).text === 'ProviderDescription') descriptions.add(binding.name.text);
    const identity = (object: ts.ObjectLiteralExpression): void => {
      const id = object.properties.find((one) => ts.isPropertyAssignment(one) && key(one.name) === 'id');
      if (id === undefined || !ts.isPropertyAssignment(id)) return;
      const held = unwrapped(id.initializer);
      const name = literal(held) ? held.text : ts.isIdentifier(held) ? values.get(held.text) : undefined;
      if (name !== undefined) words.add(name);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        const value = unwrapped(node.initializer);
        if (literal(value)) {
          values.set(node.name.text, value.text);
          if (node.name.text === 'PROVIDER' || node.name.text.endsWith('_PROVIDER')) words.add(value.text);
        }
        const type = node.type ?? annotated(node.initializer);
        if (
          type !== undefined &&
          ts.isTypeReferenceNode(type) &&
          descriptions.has(ts.isQualifiedName(type.typeName) ? type.typeName.right.text : type.typeName.text) &&
          ts.isObjectLiteralExpression(value)
        )
          identity(value);
      }
      if (ts.isObjectLiteralExpression(node)) {
        const kind = node.properties.find((one) => ts.isPropertyAssignment(one) && key(one.name) === 'kind');
        const value = kind !== undefined && ts.isPropertyAssignment(kind) ? unwrapped(kind.initializer) : undefined;
        const catalog =
          ts.isArrayLiteralExpression(node.parent) &&
          ts.isPropertyAssignment(node.parent.parent) &&
          key(node.parent.parent.name) === 'providers';
        if (catalog || (value !== undefined && literal(value) && ['wire', 'harness'].includes(value.text))) identity(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...words].filter((word) => /^[a-z][a-z0-9-]+$/.test(word)).sort((a, b) => b.length - a.length || a.localeCompare(b));
};

const propertyCursor = (node: ts.StringLiteralLike): boolean => {
  if (node.text !== 'cursor') return false;
  const parent = node.parent;
  if (ts.isCallExpression(parent)) {
    const called = parent.expression;
    if (ts.isIdentifier(called) && called.text === 'placeRole') return true;
    if (
      ts.isPropertyAccessExpression(called) &&
      called.name.text === 'get' &&
      ts.isPropertyAccessExpression(called.expression) &&
      called.expression.name.text === 'searchParams'
    )
      return true;
  }
  if (ts.isBinaryExpression(parent)) {
    const other = parent.left === node ? parent.right : parent.left;
    if (
      ts.isIdentifier(other) &&
      other.text === 'key' &&
      [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)
    )
      return true;
  }
  for (let at: ts.Node | undefined = parent; at !== undefined && ts.isTypeNode(at); at = at.parent)
    if (ts.isTypeReferenceNode(at) && ts.isIdentifier(at.typeName) && ['Pick', 'Omit'].includes(at.typeName.text)) return true;
  return false;
};

const vendorRole = (name: string): boolean =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) =>
      ['provider', 'providers', 'harness', 'harnesses', 'model', 'models', 'adapter', 'adapters', 'runner', 'cli'].includes(word),
    );
const referenceName = (node: ts.Expression): string =>
  ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? `${referenceName(node.expression)}.${node.name.text}` : '';

const cursorVendor = (node: ts.Node & { readonly text: string }, path: string): boolean => {
  if (/^(?:bad-cursor|cursor-stale)$/i.test(node.text)) return false;
  if (/(?:harness[:.]cursor|cursor-agent|@cursor\/|\.cursor\/)/i.test(node.text)) return true;
  if (path.includes('/harness/')) return true;
  for (let at: ts.Node | undefined = node.parent; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionDeclaration(at) || ts.isFunctionExpression(at) || ts.isArrowFunction(at)) break;
    if (ts.isPropertyAssignment(at)) {
      const name = key(at.name);
      if (/^(?:provider|providerId|harness|harnessId|format|cli|binary|serves|modelProvider|iconProvider)$/.test(name)) return true;
      if (
        name === 'id' &&
        ts.isObjectLiteralExpression(at.parent) &&
        at.parent.properties.some(
          (one) =>
            ts.isPropertyAssignment(one) &&
            key(one.name) === 'kind' &&
            literal(unwrapped(one.initializer)) &&
            ['wire', 'harness'].includes((unwrapped(one.initializer) as ts.StringLiteralLike).text),
        )
      )
        return true;
    }
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name) && at.initializer !== undefined) {
      const value = unwrapped(at.initializer);
      if (
        (literal(value) || ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value)) &&
        (vendorRole(at.name.text) || (at.type !== undefined && vendorRole(at.type.getText())))
      )
        return true;
    }
    if (ts.isTypeAliasDeclaration(at) && vendorRole(at.name.text)) return true;
    if (ts.isCallExpression(at) && vendorRole(referenceName(at.expression))) return true;
    if (ts.isCaseClause(at) && ts.isSwitchStatement(at.parent.parent) && vendorRole(referenceName(at.parent.parent.expression)))
      return true;
    if (ts.isBinaryExpression(at)) {
      const other = ts.isStringLiteralLike(node) && at.left === node ? at.right : at.left;
      if (vendorRole(referenceName(other))) return true;
    }
  }
  return false;
};

export type StringNode = ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;
const heldStrings = new WeakMap<ts.SourceFile, readonly StringNode[]>();
export const stringsOf = (file: ts.SourceFile): readonly StringNode[] => {
  const held = heldStrings.get(file);
  if (held !== undefined) return held;
  const strings: StringNode[] = [];
  const visit = (node: ts.Node): void => {
    if (literal(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) strings.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  heldStrings.set(file, strings);
  return strings;
};

export const isVendorSource = (path: string, params: VendorParams): boolean =>
  within(path, params.source) && !params.exclude.some((glob) => matchesGlob(path.slice(params.source.length + 1), glob));

export type VendorWords = {
  readonly mayName: (text: string) => boolean;
  readonly within: (text: string) => readonly string[];
};

const longestFirst = (left: string, right: string): number => right.length - left.length || left.localeCompare(right);

export const listedWords = (words: readonly string[]): VendorWords => ({
  mayName: (text) => {
    const lower = text.toLowerCase();
    return words.some((word) => lower.includes(word));
  },
  within: () => words,
});

const alphanumeric = (code: number): boolean => (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

const spelled = (text: string): Set<string> => {
  const found = new Set<string>();
  for (let start = 0; start < text.length; start += 1) {
    const first = text.charCodeAt(start);
    if (first < 97 || first > 122 || (start > 0 && alphanumeric(text.charCodeAt(start - 1)))) continue;
    for (let end = start + 1; end <= text.length; end += 1) {
      const next = end === text.length ? -1 : text.charCodeAt(end);
      if (end - start >= 2 && !alphanumeric(next)) found.add(text.slice(start, end));
      if (next !== 45 && !alphanumeric(next)) break;
    }
  }
  return found;
};

export const indexedWords = (has: (word: string) => boolean): VendorWords => {
  const known = new Map<string, boolean>();
  const held = (word: string): boolean => {
    let one = known.get(word);
    if (one === undefined) {
      one = has(word);
      known.set(word, one);
    }
    return one;
  };
  return {
    mayName: (text) => [...spelled(text.toLowerCase())].some(held),
    within: (text) => [...spelled(text.toLowerCase())].filter(held).sort(longestFirst),
  };
};

const patterns = new Map<string, RegExp>();

const patternOf = (word: string): RegExp => {
  let one = patterns.get(word);
  if (one === undefined) {
    one = new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'gi');
    if (patterns.size > 4096) patterns.clear();
    patterns.set(word, one);
  }
  return one;
};

export const vendorFindings = (snapshot: Snapshot, params: VendorParams, words: VendorWords): readonly Finding[] => {
  const findings: Finding[] = [];
  for (const path of snapshot.paths) {
    if (!isVendorSource(path, params)) continue;
    const text = snapshot.tree.read(path);
    if (!text.includes('\\') && !words.mayName(text)) continue;
    const file = snapshot.file(path);
    for (const node of stringsOf(file)) {
      if (literal(node) && propertyCursor(node)) continue;
      if (node.text.startsWith('@') && node.text.includes('/')) continue;
      if ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node) continue;
      const occupied = new Set<number>();
      for (const word of words.within(node.text)) {
        const pattern = patternOf(word);
        if (word === 'cursor' && !cursorVendor(node, path)) continue;
        let found = false;
        for (const match of node.text.matchAll(pattern)) {
          if ([...Array(word.length)].some((_, at) => occupied.has(match.index! + at))) continue;
          for (let at = 0; at < word.length; at++) occupied.add(match.index! + at);
          found = true;
        }
        if (found)
          findings.push({
            fingerprint: `vendor:${word}:${path}`,
            path,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            message: `names vendor or CLI ${word} outside its adapter package`,
            fix: 'Read the installed provider or harness declaration instead, or move the vendor behavior into its adapter package.',
          });
      }
    }
  }
  return findings;
};

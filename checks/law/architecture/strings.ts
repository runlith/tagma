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
    const vendor = /\/external-harnesses\/vendors\/([^/]+)\//.exec(path);
    if (member === null && vendor === null) continue;
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
      if (vendor !== null && ts.isPropertyAssignment(node) && ['harness', 'binary'].includes(key(node.name))) {
        const value = unwrapped(node.initializer);
        if (literal(value)) words.add(value.text);
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

const cursorVendor = (node: ts.Node & { readonly text: string }, path: string): boolean => {
  if (path.includes('/external-harnesses/') || path.includes('/harness/')) return true;
  if (/(?:harness:cursor|cursor:|cursor-agent|@cursor\/|\.cursor\/)/i.test(node.text)) return true;
  for (let at: ts.Node | undefined = node.parent; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
    if (
      ts.isPropertyAssignment(at) &&
      /^(?:id|provider|providerId|harness|harnessId|format|cli|binary|serves|modelProvider|iconProvider)$/.test(key(at.name))
    )
      return true;
    if (
      (ts.isVariableDeclaration(at) || ts.isTypeAliasDeclaration(at)) &&
      ts.isIdentifier(at.name) &&
      /provider|harness|model|adapter|runner|cli/i.test(at.name.text)
    )
      return true;
    if (ts.isCallExpression(at) && /provider|harness|model|adapter|runner/i.test(at.expression.getText())) return true;
    if (ts.isBinaryExpression(at)) {
      const other = ts.isStringLiteralLike(node) && at.left === node ? at.right : at.left;
      if (ts.isIdentifier(other) && /provider|harness|model|adapter|runner|format/i.test(other.text)) return true;
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

export const vendorFindings = (snapshot: Snapshot, params: VendorParams, words: readonly string[]): readonly Finding[] => {
  const findings: Finding[] = [];
  const matchers = words.map((word) => ({
    word,
    pattern: new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'gi'),
  }));
  for (const path of snapshot.paths) {
    if (!isVendorSource(path, params)) continue;
    const text = snapshot.tree.read(path);
    const lower = text.toLowerCase();
    if (!text.includes('\\') && !words.some((word) => lower.includes(word))) continue;
    const file = snapshot.file(path);
    for (const node of stringsOf(file)) {
      if (literal(node) && propertyCursor(node)) continue;
      if (node.text.startsWith('@') && node.text.includes('/')) continue;
      if ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node) continue;
      const occupied = new Set<number>();
      for (const { word, pattern } of matchers) {
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

import ts from 'typescript';
import { posix } from 'node:path';

export type Files = { readonly has: (path: string) => boolean; readonly read: (path: string) => string };
export type Form = { readonly name: string; readonly path: string; readonly line: number };
export type Declaration = {
  readonly tables: readonly { readonly symbol: string; readonly name: string }[];
  readonly histories: readonly string[];
  readonly forms: readonly Form[];
  readonly lenient: boolean;
};

const sourceFile = (path: string, text: string) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const keyOf = (node: ts.PropertyName): string => (ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : '');
const property = (node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  const held = node.properties.find((one) => ts.isPropertyAssignment(one) && keyOf(one.name) === name);
  return held !== undefined && ts.isPropertyAssignment(held) ? held.initializer : undefined;
};

export const declarationOf = (tree: Files, path: string, side: 'tree' | 'base'): Declaration => {
  const tables = new Map<string, string>();
  const histories = new Set<string>();
  const forms = new Map<string, Form>();
  const parsed = new Map<string, ts.SourceFile>();
  let lenient = false;
  const fileAt = (path: string): ts.SourceFile => {
    const previous = parsed.get(path);
    if (previous !== undefined) return previous;
    if (!tree.has(path)) throw new Error(`declaration source ${path} is missing`);
    const file = sourceFile(path, tree.read(path));
    parsed.set(path, file);
    return file;
  };
  const resolve = (value: ts.Expression, path: string, seen = new Set<string>()): { value: ts.Expression; path: string } => {
    if (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value))
      return resolve(value.expression, path, seen);
    if (!ts.isIdentifier(value)) return { value, path };
    const key = `${path}:${value.text}`;
    if (seen.has(key)) throw new Error(`cyclic declaration ${key}`);
    seen.add(key);
    const file = fileAt(path);
    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement)) {
        const held = statement.declarationList.declarations.find((entry) => ts.isIdentifier(entry.name) && entry.name.text === value.text);
        if (held?.initializer !== undefined) return resolve(held.initializer, path, seen);
      }
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const bindings = statement.importClause?.namedBindings;
        const imported =
          bindings !== undefined && ts.isNamedImports(bindings)
            ? bindings.elements.find((entry) => entry.name.text === value.text)
            : undefined;
        if (imported === undefined) continue;
        if (!statement.moduleSpecifier.text.startsWith('.')) throw new Error(`form declaration ${key} is outside the inspected source`);
        const target = posix.normalize(posix.join(posix.dirname(path), statement.moduleSpecifier.text)).replace(/\.js$/, '.ts');
        const resolved = target.endsWith('.ts') ? target : `${target}.ts`;
        return resolve(ts.factory.createIdentifier(imported.propertyName?.text ?? imported.name.text), resolved, seen);
      }
    }
    throw new Error(`declaration ${key} is not a literal binding`);
  };
  const collectForms = (expression: ts.Expression, from: string): void => {
    const { value, path } = resolve(expression, from);
    if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) collectForms(ts.isSpreadElement(element) ? element.expression : element, path);
      return;
    }
    if (!ts.isObjectLiteralExpression(value)) throw new Error(`${path}: form step is not an object declaration`);
    const name = property(value, 'name');
    if (name === undefined || !ts.isStringLiteral(name)) throw new Error(`${path}: form step name is not literal`);
    if (forms.has(name.text)) throw new Error(`${path}: repeated form step ${name.text}`);
    const file = fileAt(path);
    forms.set(name.text, { name: name.text, path, line: file.getLineAndCharacterOfPosition(name.getStart(file)).line + 1 });
  };
  {
    const file = fileAt(path);
    const manifestNames = new Set(['manifest']);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings))
        for (const binding of bindings.elements)
          if ((binding.propertyName?.text ?? binding.name.text) === 'manifest') manifestNames.add(binding.name.text);
    }
    const contributed = (node: ts.Node): boolean => {
      if (!ts.isObjectLiteralExpression(node.parent) || !ts.isCallExpression(node.parent.parent)) return false;
      const call = node.parent.parent.expression;
      return ts.isIdentifier(call) ? manifestNames.has(call.text) : ts.isPropertyAccessExpression(call) && call.name.text === 'manifest';
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        if (
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === 'sqliteTable'
        ) {
          const name = node.initializer.arguments[0];
          if (name === undefined || !ts.isStringLiteral(name)) throw new Error(`${path}: table name is not literal`);
          const previous = tables.get(node.name.text);
          if (previous !== undefined && previous !== name.text) throw new Error(`${path}: ambiguous table symbol ${node.name.text}`);
          tables.set(node.name.text, name.text);
        }
      }
      if (ts.isPropertyAssignment(node) && keyOf(node.name) === 'formSteps' && contributed(node)) collectForms(node.initializer, path);
      if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) && keyOf(node.name) === 'tables' && contributed(node)) {
        const callable = ts.isMethodDeclaration(node) ? node : resolve(node.initializer, path).value;
        if (!(ts.isMethodDeclaration(callable) || ts.isArrowFunction(callable) || ts.isFunctionExpression(callable)))
          throw new Error(`${path}: table contribution is not a readable function`);
        if (callable.body === undefined) throw new Error(`${path}: table declaration has no body`);
        let found = false;
        const classified = (expression: ts.Expression): void => {
          const returned = resolve(expression, path);
          if (side === 'base' && !ts.isObjectLiteralExpression(returned.value)) {
            lenient = true;
            found = true;
            return;
          }
          if (!ts.isObjectLiteralExpression(returned.value)) throw new Error(`${path}: tables must declare entities and history`);
          const history = property(returned.value, 'history');
          if (history === undefined) throw new Error(`${path}: tables have no history classification`);
          const held = resolve(history, returned.path).value;
          if (!ts.isArrayLiteralExpression(held)) throw new Error(`${path}: history table declaration is not an array`);
          for (const table of held.elements) {
            if (ts.isIdentifier(table)) histories.add(table.text);
            else if (ts.isPropertyAccessExpression(table)) histories.add(table.name.text);
            else throw new Error(`${path}: history table is not a named declaration`);
          }
          found = true;
        };
        const collect = (child: ts.Node): void => {
          if (ts.isReturnStatement(child) && child.expression !== undefined) classified(child.expression);
          else ts.forEachChild(child, collect);
        };
        if (ts.isBlock(callable.body)) collect(callable.body);
        else classified(callable.body);
        if (!found) throw new Error(`${path}: tables have no readable classification`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return {
    tables: [...tables].map(([symbol, name]) => ({ symbol, name })),
    histories: [...histories],
    forms: [...forms.values()],
    lenient,
  };
};

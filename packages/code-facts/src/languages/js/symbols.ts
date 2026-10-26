import ts from 'typescript';
import { posix } from 'node:path';
import type {
  SymbolDefinition,
  SymbolExport,
  SymbolForward,
  SymbolImport,
  SymbolMeaning,
  SymbolReader,
  SymbolReference,
  Symbols,
  SymbolSpace,
  SymbolTarget,
  SymbolSpelling,
} from '../../adapter';
import type { Tree } from '../../tree';
import { UnsupportedSource } from '../../imports';
import { configResolver } from './config';
import { resolve } from './resolve';
import type { Script, Scripts } from './imports';

const spacesOf = (declaration: ts.Declaration, symbol: ts.Symbol): readonly SymbolSpace[] => {
  if (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration) || ts.isTypeParameterDeclaration(declaration))
    return ['type'];
  if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration) || ts.isEnumDeclaration(declaration))
    return ['type', 'value'];
  if (ts.isModuleDeclaration(declaration)) return symbol.flags & ts.SymbolFlags.ValueModule ? ['value', 'namespace'] : ['namespace'];
  return ['value'];
};

const meaningOf = (node: ts.Identifier): SymbolMeaning => {
  let held: ts.Node = node;
  for (let parent = held.parent; parent !== undefined; held = parent, parent = parent.parent) {
    if (ts.isTypeQueryNode(parent)) return 'value';
    if (ts.isQualifiedName(parent) && parent.left === held) return 'namespace';
    if (ts.isExportAssignment(parent) || ts.isExportSpecifier(parent)) return 'all';
    if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent))
      return parent.parent.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(parent.parent.parent) ? 'type' : 'value';
    if (ts.isTypeNode(parent)) return 'type';
    if (ts.isExpression(parent) || ts.isStatement(parent)) break;
  }
  return 'value';
};

const moduleAt = (node: ts.Node): string | undefined => {
  for (let held: ts.Node | undefined = node; held !== undefined; held = held.parent) {
    if (
      (ts.isImportDeclaration(held) || ts.isExportDeclaration(held)) &&
      held.moduleSpecifier !== undefined &&
      ts.isStringLiteral(held.moduleSpecifier)
    )
      return held.moduleSpecifier.text;
    if (
      ts.isImportEqualsDeclaration(held) &&
      ts.isExternalModuleReference(held.moduleReference) &&
      held.moduleReference.expression !== undefined &&
      ts.isStringLiteral(held.moduleReference.expression)
    )
      return held.moduleReference.expression.text;
  }
  return undefined;
};

const importedOf = (symbol: ts.Symbol, meaning: SymbolMeaning): SymbolImport | undefined => {
  for (const declaration of symbol.declarations ?? []) {
    const from = moduleAt(declaration);
    if (from === undefined) continue;
    if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration))
      return { from, name: (declaration.propertyName ?? declaration.name).text, meaning };
    if (ts.isImportClause(declaration)) return { from, name: 'default', meaning };
    if (ts.isNamespaceImport(declaration) || ts.isNamespaceExport(declaration) || ts.isImportEqualsDeclaration(declaration))
      return { from, name: '*', meaning };
  }
  return undefined;
};

const isName = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent)) &&
    parent.name === node
  )
    return true;
  if (ts.isImportSpecifier(parent)) return true;
  if (ts.isExportSpecifier(parent) && node !== (parent.propertyName ?? parent.name)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isJsxAttribute(parent) && parent.name === node) return true;
  return (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node;
};

const readScript = (script: Script, path: string, source: string): Symbols => {
  const { text, at: offset } = script;
  const kind = /(?:\.[jt]sx|\.[cm]?js)$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const rootName = `${path}.binding.${kind === ts.ScriptKind.TSX ? 'tsx' : 'ts'}`;
  const file = ts.createSourceFile(rootName, text, ts.ScriptTarget.Latest, true, kind);
  const program = ts.createProgram(
    [rootName],
    { noLib: true, noResolve: true, types: [], noEmit: true, allowJs: true },
    {
      getSourceFile: (wanted) => (wanted === rootName ? file : undefined),
      getDefaultLibFileName: () => '',
      getCurrentDirectory: () => '/',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      readFile: () => undefined,
      fileExists: (wanted) => wanted === rootName,
      writeFile: () => undefined,
      getNewLine: () => '\n',
    },
  );
  const errors = program.getSyntacticDiagnostics(file);
  if (errors.length > 0) throw new UnsupportedSource(path, ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n'));
  const checker = program.getTypeChecker();
  const starts = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
  const position = (node: ts.Node) => {
    const at = offset + node.getStart(file);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (starts[middle]! <= at) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: at - starts[low]! + 1 };
  };
  const targets = new Map<ts.Symbol, Map<SymbolMeaning, SymbolTarget>>();
  const target = (symbol: ts.Symbol, meaning: SymbolMeaning): SymbolTarget => {
    const cached = targets.get(symbol)?.get(meaning);
    if (cached !== undefined) return cached;
    const remember = (result: SymbolTarget): SymbolTarget => {
      const meanings = targets.get(symbol) ?? new Map<SymbolMeaning, SymbolTarget>();
      meanings.set(meaning, result);
      targets.set(symbol, meanings);
      return result;
    };
    const seen = new Set<ts.Symbol>();
    let held = symbol;
    while ((held.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(held)) {
      seen.add(held);
      const imported = importedOf(held, meaning);
      if (imported !== undefined) return remember({ definitions: [], imported });
      held = checker.getAliasedSymbol(held);
    }
    return remember({
      definitions: (held.declarations ?? []).flatMap((declaration): SymbolDefinition[] => {
        const spaces = spacesOf(declaration, held);
        if (meaning !== 'all' && !spaces.includes(meaning)) return [];
        const name = ts.getNameOfDeclaration(declaration);
        return name === undefined ? [] : [{ name: name.getText(file), ...position(name), spaces }];
      }),
      imported: undefined,
    });
  };
  const references: SymbolReference[] = [];
  const names: SymbolSpelling[] = [];
  const uses = new Set<string>();
  const imports = new Set<string>();
  const ownerOf = (node: ts.Node): string => {
    const owners: string[] = [];
    for (let parent = node.parent; parent !== undefined && !ts.isSourceFile(parent); parent = parent.parent) {
      if (
        ts.isClassDeclaration(parent) ||
        ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent) ||
        ts.isModuleDeclaration(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isPropertyDeclaration(parent)
      ) {
        const name = ts.getNameOfDeclaration(parent);
        if (name !== undefined) owners.push(name.getText(file));
      }
    }
    return owners.reverse().join('.');
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          checker.getSymbolAtLocation(node.expression) === undefined))
    )
      imports.add(node.arguments[0].text);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    )
      imports.add(node.moduleReference.expression.text);
    const statement =
      ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)
        ? node.parent.parent
        : node;
    const moduleLevel = statement.parent !== undefined && (ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent));
    const declaration =
      moduleLevel &&
      (script.module ||
        (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword))) &&
      (ts.isVariableDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node));
    if (
      declaration ||
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isEnumMember(node) ||
      ts.isExportSpecifier(node) ||
      ts.isNamespaceExport(node)
    ) {
      const name = ts.getNameOfDeclaration(node);
      if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)))
        names.push({ name: name.text, owner: ownerOf(node), line: position(name).line });
    }
    if (
      ts.isBindingElement(node) &&
      node.propertyName === undefined &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isIdentifier(node.name)
    )
      uses.add(node.name.text);
    if (ts.isIdentifier(node) && !isName(node)) {
      const meaning = meaningOf(node);
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : ts.isExportSpecifier(node.parent)
          ? checker.getExportSpecifierLocalTargetSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
      const found = symbol === undefined ? { definitions: [], imported: undefined } : target(symbol, meaning);
      let imported = found.imported;
      if (imported?.name === '*') {
        let held: ts.Node = node;
        const names: string[] = [];
        while (
          (ts.isPropertyAccessExpression(held.parent) && held.parent.expression === held) ||
          (ts.isQualifiedName(held.parent) && held.parent.left === held)
        ) {
          const parent = held.parent;
          names.push(ts.isPropertyAccessExpression(parent) ? parent.name.text : parent.right.text);
          held = parent;
        }
        imported = {
          ...imported,
          name: names.length === 0 ? '*' : names.join('.'),
          meaning: names.length === 0 ? 'all' : meaningOfName(held),
        };
      }
      references.push({ name: node.text, ...position(node), meaning, definitions: found.definitions, imported });
      uses.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const forwards: SymbolForward[] = [];
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier))
      imports.add(statement.moduleSpecifier.text);
    if (
      script.module &&
      ts.isExportDeclaration(statement) &&
      statement.exportClause === undefined &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      forwards.push({ from: statement.moduleSpecifier.text, line: position(statement).line });
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const from = statement.moduleSpecifier.text;
    imports.add(from);
    const note = (node: ts.Identifier, name: string, meaning: SymbolMeaning) =>
      references.push({ name: node.text, ...position(node), meaning, definitions: [], imported: { from, name, meaning } });
    if (clause?.name !== undefined) note(clause.name, 'default', clause.isTypeOnly ? 'type' : 'all');
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings))
      for (const binding of clause.namedBindings.elements)
        note(binding.name, (binding.propertyName ?? binding.name).text, clause.isTypeOnly || binding.isTypeOnly ? 'type' : 'all');
    else if (clause?.namedBindings !== undefined) note(clause.namedBindings.name, '*', 'all');
  }
  const exports: SymbolExport[] = [];
  const module = checker.getSymbolAtLocation(file);
  const exported = (symbol: ts.Symbol, prefix: string, seen: Set<ts.Symbol>): void => {
    if (seen.has(symbol)) return;
    const name = `${prefix}${symbol.name}`;
    const found = target(symbol, 'all');
    const declaration = symbol.declarations?.[0];
    exports.push({ name, line: declaration === undefined ? 1 : position(declaration).line, ...found });
    if ((symbol.flags & ts.SymbolFlags.Namespace) === 0) return;
    seen.add(symbol);
    for (const member of checker.getExportsOfModule(symbol)) exported(member, `${name}.`, seen);
    seen.delete(symbol);
  };
  for (const symbol of !script.module || module === undefined ? [] : checker.getExportsOfModule(module)) exported(symbol, '', new Set());
  return { references, exports, forwards, names, uses: [...uses], imports: [...imports] };
};

const meaningOfName = (node: ts.Node): SymbolMeaning => {
  if (ts.isPropertyAccessExpression(node)) return 'value';
  if (ts.isQualifiedName(node)) return ts.isTypeQueryNode(node.parent) ? 'value' : 'type';
  return 'all';
};

const local = (path: string): string => path.replace(/^\//, '');

const resolution = (specifier: string, from: string, tree: Tree) => {
  const relative = resolve(specifier, from, tree);
  if (relative !== null && 'to' in relative) return relative;
  const configured = configResolver(tree, () => undefined, new Map())(specifier, from, tree, new Set());
  if (configured !== null && 'to' in configured) return configured;
  const found = ts.resolveModuleName(
    specifier,
    posix.resolve('/', from),
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      customConditions: ['bun'],
    },
    {
      fileExists: (path) => tree.has(local(path)),
      readFile: (path) => (tree.has(local(path)) ? tree.read(local(path)) : undefined),
      realpath: (path) => posix.resolve('/', tree.realpath?.(local(path)) ?? local(path)),
    },
  ).resolvedModule;
  return found === undefined ? (relative ?? configured) : { to: local(found.resolvedFileName) };
};

export const symbolReader = (scripts: Scripts): SymbolReader => ({
  read: (source, path) => {
    const fragments = scripts(source, path).map((script) => readScript(script, path, source));
    return {
      references: fragments.flatMap((one) => one.references),
      exports: fragments.flatMap((one) => one.exports),
      forwards: fragments.flatMap((one) => one.forwards),
      names: fragments.flatMap((one) => one.names),
      uses: [...new Set(fragments.flatMap((one) => one.uses))],
      imports: [...new Set(fragments.flatMap((one) => one.imports))],
    };
  },
  resolve: resolution,
});

import ts from 'typescript';
import { posix } from 'node:path';
import type {
  SymbolDefinition,
  SymbolExport,
  SymbolForward,
  SymbolImport,
  SymbolMeaning,
  SymbolPlacing,
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

const assigned = (node: ts.Node): boolean => {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent)) return parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) return parent.initializer === node;
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node && assigned(parent.parent);
  return (ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent)) && assigned(parent);
};

type Spelled = { readonly name: ts.Identifier; readonly symbol: ts.Symbol | undefined };

const identifierSymbol = (node: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined =>
  ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : ts.isExportSpecifier(node.parent)
      ? checker.getExportSpecifierLocalTargetSymbol(node.parent)
      : checker.getSymbolAtLocation(node);

const memberSpellings = (node: ts.Node, checker: ts.TypeChecker): readonly Spelled[] => {
  if (ts.isBindingElement(node) && node.propertyName === undefined && ts.isObjectBindingPattern(node.parent) && ts.isIdentifier(node.name))
    return [{ name: node.name, symbol: checker.getPropertyOfType(checker.getTypeAtLocation(node.parent), node.name.text) }];
  if (!ts.isObjectLiteralExpression(node) || !assigned(node)) return [];
  return node.properties.flatMap((property) =>
    (ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property)) && ts.isIdentifier(property.name)
      ? [{ name: property.name, symbol: checker.getPropertySymbolOfDestructuringAssignment(property.name) }]
      : [],
  );
};

const kindOf = (path: string): ts.ScriptKind => (/(?:\.[jt]sx|\.[cm]?js)$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const startsOf = (source: string): readonly number[] => {
  const starts = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
};

const located = (starts: readonly number[], at: number) => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (starts[middle]! <= at) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: at - starts[low]! + 1 };
};

const hostOver = (files: ReadonlyMap<string, ts.SourceFile>): ts.CompilerHost => ({
  getSourceFile: (wanted) => files.get(wanted),
  getDefaultLibFileName: () => '',
  getCurrentDirectory: () => '/',
  getCanonicalFileName: (name) => name,
  useCaseSensitiveFileNames: () => true,
  readFile: () => undefined,
  fileExists: (wanted) => files.has(wanted),
  writeFile: () => undefined,
  getNewLine: () => '\n',
});

const readScript = (script: Script, path: string, source: string, lines?: ReadonlySet<number>): Symbols => {
  const { text, at: offset } = script;
  const kind = kindOf(path);
  const rootName = `${path}.binding.${kind === ts.ScriptKind.TSX ? 'tsx' : 'ts'}`;
  const file = ts.createSourceFile(rootName, text, ts.ScriptTarget.Latest, true, kind);
  const program = ts.createProgram(
    [rootName],
    { noLib: true, noResolve: true, types: [], noEmit: true, allowJs: true },
    hostOver(new Map([[rootName, file]])),
  );
  const errors = program.getSyntacticDiagnostics(file);
  if (errors.length > 0) throw new UnsupportedSource(path, ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n'));
  const checker = program.getTypeChecker();
  const starts = startsOf(source);
  const position = (node: ts.Node) => located(starts, offset + node.getStart(file));
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
  const chosen = (node: ts.Node): boolean => lines === undefined || lines.has(position(node).line);
  const note = (reference: SymbolReference, included = false): void => {
    if (included || lines === undefined || lines.has(reference.line)) references.push(reference);
  };
  const use = (node: ts.Identifier, found: SymbolTarget | undefined): void => {
    if (chosen(node) && (found === undefined || found.imported !== undefined || found.definitions.length === 0)) uses.add(node.text);
  };
  const imports = new Set<string>();
  const changedImports = new Map<ts.Symbol, boolean>();
  const changedImport = (symbol: ts.Symbol): boolean => {
    const cached = changedImports.get(symbol);
    if (cached !== undefined) return cached;
    const changed = (symbol.declarations ?? []).some((declaration) => {
      for (let node: ts.Node | undefined = declaration; node !== undefined; node = node.parent) {
        if (ts.isImportDeclaration(node)) return chosen(node) || chosen(node.moduleSpecifier) || chosen(declaration);
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
          return chosen(node) || (node.moduleReference.expression !== undefined && chosen(node.moduleReference.expression));
      }
      return false;
    });
    changedImports.set(symbol, changed);
    return changed;
  };
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
    for (const member of memberSpellings(node, checker))
      use(member.name, member.symbol === undefined ? undefined : target(member.symbol, 'all'));
    if (ts.isIdentifier(node) && !isName(node)) {
      const meaning = meaningOf(node);
      const symbol = identifierSymbol(node, checker);
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
      note(
        { name: node.text, ...position(node), meaning, definitions: found.definitions, imported },
        imported !== undefined && symbol !== undefined && changedImport(symbol),
      );
      use(node, symbol === undefined ? undefined : target(symbol, 'all'));
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
    const imported = (node: ts.Identifier, name: string, meaning: SymbolMeaning) => {
      const symbol = checker.getSymbolAtLocation(node);
      note(
        { name: node.text, ...position(node), meaning, definitions: [], imported: { from, name, meaning } },
        symbol !== undefined && changedImport(symbol),
      );
    };
    if (clause?.name !== undefined) imported(clause.name, 'default', clause.isTypeOnly ? 'type' : 'all');
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings))
      for (const binding of clause.namedBindings.elements)
        imported(binding.name, (binding.propertyName ?? binding.name).text, clause.isTypeOnly || binding.isTypeOnly ? 'type' : 'all');
    else if (clause?.namedBindings !== undefined) imported(clause.namedBindings.name, '*', 'all');
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

const derivations = (node: ts.Node): readonly ts.Node[] => {
  if (ts.isBindingElement(node)) return node.initializer === undefined ? [node.parent.parent] : [node.parent.parent, node.initializer];
  if (ts.isFunctionLike(node)) return node.type !== undefined || !('body' in node) || node.body === undefined ? [] : [node.body];
  if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
    if (node.type !== undefined) return [];
    if (node.initializer !== undefined) return [node.initializer];
    return ts.isParameter(node) ? [node.parent.parent] : [];
  }
  if (ts.isPropertyAssignment(node)) return [node.initializer];
  if (ts.isShorthandPropertyAssignment(node)) return [node.name];
  if (ts.isExportAssignment(node)) return [node.expression];
  return [];
};

const declared = (node: ts.Node): boolean =>
  ts.isBindingElement(node) ||
  ts.isFunctionLike(node) ||
  ts.isVariableDeclaration(node) ||
  ts.isParameter(node) ||
  ts.isPropertyDeclaration(node) ||
  ts.isPropertySignature(node) ||
  ts.isPropertyAssignment(node) ||
  ts.isShorthandPropertyAssignment(node) ||
  ts.isExportAssignment(node) ||
  ts.isClassLike(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isEnumDeclaration(node) ||
  ts.isEnumMember(node) ||
  ts.isModuleDeclaration(node) ||
  ts.isTypeParameterDeclaration(node) ||
  ts.isSourceFile(node);

const receiversOf = (name: ts.Identifier): readonly ts.Node[] => {
  const parent = name.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === name) return [parent.expression];
  if (ts.isBindingElement(parent)) return [parent.parent.parent];
  if (!ts.isShorthandPropertyAssignment(parent) && !ts.isPropertyAssignment(parent)) return [];
  const sources: ts.Node[] = [];
  let held: ts.Node = parent.parent;
  while (assigned(held)) {
    const above = held.parent;
    if (ts.isForOfStatement(above) || ts.isForInStatement(above)) return [...sources, above.expression];
    if (ts.isBinaryExpression(above)) sources.push(above.right);
    held = ts.isPropertyAssignment(above) ? above.parent : above;
  }
  return sources;
};

type Unit = { readonly path: string; readonly file: ts.SourceFile };

const placing =
  (scripts: Scripts) =>
  (input: SymbolPlacing): readonly string[] => {
    const { path, tree } = input;
    const files = new Map<string, ts.SourceFile>();
    const units = new Map<string, Unit>();
    const add = (name: string, owner: string, text: string): Unit => {
      const kind = kindOf(owner);
      const fileName = `/${name}.${kind === ts.ScriptKind.TSX ? 'tsx' : 'ts'}`;
      const unit = { path: owner, file: ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind) };
      files.set(fileName, unit.file);
      units.set(fileName, unit);
      return unit;
    };
    const starts = startsOf(input.text);
    const roots = scripts(input.text, path).map((script, index) => ({
      ...add(`${path}.place.${index}`, path, script.text),
      offset: script.at,
    }));
    const byPath = new Map<string, string>();
    for (const other of input.files) {
      if (other === path || byPath.has(other)) continue;
      const fragments = scripts(tree.read(other), other);
      const only = fragments[0];
      if (fragments.length !== 1 || only === undefined || only.at !== 0 || !only.module) continue;
      byPath.set(other, add(other, other, only.text).file.fileName);
    }
    const resolved = new Map<string, string | undefined>();
    const targetOf = (specifier: string, from: string): string | undefined => {
      const key = `${from}\0${specifier}`;
      if (resolved.has(key)) return resolved.get(key);
      const found = resolution(specifier, from, tree);
      const name = found !== null && 'to' in found ? byPath.get(tree.realpath?.(found.to) ?? found.to) : undefined;
      resolved.set(key, name);
      return name;
    };
    const program = ts.createProgram(
      [...files.keys()],
      { noLib: true, types: [], noEmit: true, allowJs: true },
      {
        ...hostOver(files),
        resolveModuleNameLiterals: (literals, containing) =>
          literals.map((literal) => {
            const from = units.get(containing)?.path;
            const name = from === undefined ? undefined : targetOf(literal.text, from);
            return {
              resolvedModule:
                name === undefined
                  ? undefined
                  : {
                      resolvedFileName: name,
                      extension: name.endsWith('.tsx') ? ts.Extension.Tsx : ts.Extension.Ts,
                      isExternalLibraryImport: false,
                    },
            };
          }),
      },
    );
    const checker = program.getTypeChecker();
    const aliased = (symbol: ts.Symbol | undefined): ts.Symbol | undefined =>
      symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
    const guessed = (node: ts.CallLikeExpression): boolean => {
      if (ts.isTaggedTemplateExpression(node)) return checker.getTypeAtLocation(node.tag).getCallSignatures().length > 1;
      if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
      const callee = checker.getTypeAtLocation(node.expression);
      const signatures = ts.isNewExpression(node) ? callee.getConstructSignatures() : callee.getCallSignatures();
      return (
        signatures.length > 1 &&
        (node.arguments ?? []).some((argument) => (checker.getTypeAtLocation(argument).flags & ts.TypeFlags.Any) !== 0)
      );
    };
    const clean = new Set<ts.Node>();
    const settled = (receivers: readonly ts.Node[]): boolean => {
      const seen = new Set<ts.Node>();
      const pending = [...receivers];
      while (pending.length > 0) {
        const node = pending.pop()!;
        if (clean.has(node) || seen.has(node)) continue;
        seen.add(node);
        if (declared(node)) {
          pending.push(...derivations(node));
          continue;
        }
        if (ts.isIdentifier(node)) {
          pending.push(...(aliased(identifierSymbol(node, checker))?.declarations ?? []));
          continue;
        }
        if (ts.isCallLikeExpression(node)) {
          if (guessed(node)) return false;
          const declaration = checker.getResolvedSignature(node)?.declaration;
          if (declaration !== undefined && !ts.isJSDocSignature(declaration)) pending.push(declaration);
        }
        ts.forEachChild(node, (child) => {
          pending.push(child);
        });
      }
      for (const node of seen) clean.add(node);
      return true;
    };
    const wanted = new Set(input.names);
    const lines = input.lines === undefined ? undefined : new Set(input.lines);
    const placed = new Map<string, boolean>();
    for (const unit of roots) {
      const visit = (node: ts.Node): void => {
        const spelled =
          ts.isIdentifier(node) && !isName(node)
            ? [{ name: node, symbol: identifierSymbol(node, checker) }]
            : memberSpellings(node, checker);
        for (const one of spelled) {
          const name = one.name.text;
          if (!wanted.has(name) || placed.get(name) === false) continue;
          if (lines !== undefined && !lines.has(located(starts, unit.offset + one.name.getStart(unit.file)).line)) continue;
          placed.set(name, (aliased(one.symbol)?.declarations ?? []).length > 0 && settled(receiversOf(one.name)));
        }
        ts.forEachChild(node, visit);
      };
      visit(unit.file);
    }
    return [...placed].flatMap(([name, all]) => (all ? [name] : []));
  };

export const symbolReader = (scripts: Scripts): SymbolReader => ({
  place: placing(scripts),
  read: (source, path, lines) => {
    const selected = lines === undefined ? undefined : new Set(lines);
    const fragments = scripts(source, path).map((script) => readScript(script, path, source, selected));
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

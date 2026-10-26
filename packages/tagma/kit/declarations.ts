import { dirname, resolve } from 'node:path';
import { signatureOf } from '@tagma/inspection/signature';
import type { Schema } from 'effect';
import ts from 'typescript';
export type RulesDoor = { readonly key: string; readonly source: string };

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  declaration: true,
  emitDeclarationOnly: true,
  noLib: true,
  strict: true,
  types: [],
};

const PRIVATE = '@tagma/';

const expandedSource = async (door: RulesDoor): Promise<ts.SourceFile> => {
  const text = await Bun.file(door.source).text();
  const source = ts.createSourceFile(door.source, text, ts.ScriptTarget.Latest, true);
  const imported = new Map<string, unknown>();
  const edits: { readonly start: number; readonly end: number; readonly text: string }[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(PRIVATE)
    )
      continue;
    const exports: Readonly<Record<string, unknown>> = await import(statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings))
      throw new Error(`${door.source}: a private rules import must name its bindings`);
    for (const binding of bindings.elements) imported.set(binding.name.text, exports[(binding.propertyName ?? binding.name).text]);
    edits.push({ start: statement.getFullStart(), end: statement.end, text: '' });
  }
  const refers = (node: ts.Node): boolean => (ts.isIdentifier(node) && imported.has(node.text)) || ts.forEachChild(node, refers) === true;
  const valueOf = (node: ts.TypeNode): unknown => {
    if (ts.isParenthesizedTypeNode(node)) return valueOf(node.type);
    if (ts.isTypeQueryNode(node) && ts.isIdentifier(node.exprName)) return imported.get(node.exprName.text);
    if (ts.isIndexedAccessTypeNode(node)) {
      const value = valueOf(node.objectType);
      if (ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteral(node.indexType.literal))
        return node.indexType.literal.text === 'Encoded'
          ? value
          : (value as Readonly<Record<string, unknown>>)[node.indexType.literal.text];
      if (node.indexType.kind === ts.SyntaxKind.NumberKeyword && Array.isArray(value)) return value;
    }
    throw new Error(`${door.source}: cannot expand ${node.getText()}`);
  };
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || !refers(statement.type)) continue;
    const value = valueOf(statement.type);
    const expanded = Array.isArray(value) ? value.map((one) => JSON.stringify(one)).join(' | ') : signatureOf(value as Schema.Top);
    edits.push({ start: statement.type.getStart(source), end: statement.type.end, text: expanded });
  }
  const expanded = edits
    .sort((left, right) => right.start - left.start)
    .reduce((at, edit) => at.slice(0, edit.start) + edit.text + at.slice(edit.end), text);
  return ts.createSourceFile(door.source, expanded, ts.ScriptTarget.Latest, true);
};

export const declarationsOf = async (doors: readonly RulesDoor[]): Promise<Readonly<Record<string, string>>> => {
  const sources = new Map<string, ts.SourceFile>();
  for (const door of doors) sources.set(door.source, await expandedSource(door));
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (file) => sources.get(file);
  host.fileExists = (file) => sources.has(file);
  host.readFile = (file) => sources.get(file)?.text;
  host.resolveModuleNames = (names, file) =>
    names.map((name) => {
      const target = resolve(dirname(file), name.replace(/\.js$/u, '.ts'));
      return sources.has(target) ? { resolvedFileName: target, extension: ts.Extension.Ts } : undefined;
    });
  const emitted = new Map<string, string>();
  const program = ts.createProgram(
    doors.map((door) => door.source),
    options,
    host,
  );
  const result = program.emit(
    undefined,
    (_file, text, _bom, _error, owners) => {
      if (owners?.length !== 1) throw new Error('A rules declaration has no source owner');
      emitted.set(owners[0]!.fileName, text);
    },
    undefined,
    true,
  );
  if (result.emitSkipped || result.diagnostics.length > 0)
    throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host));
  return Object.fromEntries(
    doors.map((door) => {
      const declaration = emitted.get(door.source);
      if (declaration === undefined) throw new Error(`${door.source} emitted no declaration`);
      return [door.key, declaration];
    }),
  );
};

export const signaturesOf = (declarations: Readonly<Record<string, string>>): Readonly<Record<string, string>> => {
  const sources = Object.values(declarations).map((text, at) => ts.createSourceFile(`${at}.d.ts`, text, ts.ScriptTarget.Latest, true));
  const aliases = new Map(
    sources.flatMap((source) => source.statements.filter(ts.isTypeAliasDeclaration).map((alias) => [alias.name.text, alias] as const)),
  );
  const functions = new Map<string, ts.FunctionDeclaration[]>();
  for (const source of sources)
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
      const previous = functions.get(statement.name.text) ?? [];
      previous.push(statement);
      functions.set(statement.name.text, previous);
    }
  const signatures: Record<string, string> = {};
  const document = (name: string, calls: readonly ts.SignatureDeclaration[]) => {
    const needed = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !needed.has(node.typeName.text)) {
        const alias = aliases.get(node.typeName.text);
        if (alias !== undefined) {
          needed.add(node.typeName.text);
          visit(alias.type);
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const call of calls) visit(call);
    const [space, member] = name.split('.');
    const declarations = calls.map(
      (call) =>
        `function ${member ?? space}${call.typeParameters === undefined ? '' : `<${call.typeParameters.map((one) => one.getText()).join(', ')}>`}(${call.parameters.map((one) => one.getText()).join(', ')}): ${call.type?.getText() ?? 'unknown'};`,
    );
    signatures[name] = [
      member === undefined
        ? declarations.map((one) => `declare ${one}`).join('\n')
        : `declare namespace ${space} {\n${declarations.map((one) => `  ${one}`).join('\n')}\n}`,
      ...[...needed].map((key) => aliases.get(key)!.getText()),
    ].join('\n\n');
  };
  for (const source of sources)
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.type === undefined) continue;
        const name = declaration.name.text;
        if (ts.isFunctionTypeNode(declaration.type)) document(name, [declaration.type]);
        if (!ts.isTypeLiteralNode(declaration.type)) continue;
        for (const member of declaration.type.members) {
          if (!ts.isPropertySignature(member) || member.type === undefined || member.name === undefined) continue;
          const calls = ts.isFunctionTypeNode(member.type)
            ? [member.type]
            : ts.isTypeQueryNode(member.type)
              ? functions.get(member.type.exprName.getText())
              : undefined;
          if (calls !== undefined) document(`${name}.${member.name.getText()}`, calls);
        }
      }
    }
  return signatures;
};

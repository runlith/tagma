import { createHash } from 'node:crypto';
import ts from 'typescript';

import {
  type Binding,
  EMPTY_FACTS,
  type ExportKind,
  type Exported,
  type Facts,
  type Forward,
  type Import,
  type Load,
  SOURCE,
  type Shape,
  type Use,
} from './facts';

const KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  '.tsx': ts.ScriptKind.TSX,
  '.jsx': ts.ScriptKind.TSX,
};

type Block = { readonly text: string; readonly line: number; readonly exports: boolean };

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const blocksOf = (path: string, text: string): { readonly blocks: readonly Block[]; readonly template: string } => {
  if (!path.endsWith('.svelte')) return { blocks: [{ text, line: 0, exports: true }], template: '' };
  const blocks: Block[] = [];
  let template = text;
  for (const match of text.matchAll(SCRIPT)) {
    const body = match[2]!;
    const start = match.index + match[0].indexOf('>') + 1;
    blocks.push({
      text: body,
      line: text.slice(0, start).split('\n').length - 1,
      exports: /\b(?:module|context\s*=\s*["']module["'])/.test(match[1]!),
    });
    template = template.replace(match[0], '');
  }
  return { blocks, template };
};

const extensionOf = (path: string): string => path.slice(path.lastIndexOf('.'));

const textOf = (node: ts.Node, file: ts.SourceFile): string => node.getText(file).replace(/\s+/g, ' ');

const literalText = (node: ts.Node): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

const nameText = (name: ts.PropertyName | ts.BindingName, file: ts.SourceFile): string =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : textOf(name, file);

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16);

const scopes = new WeakMap<ts.SourceFile, (head: string) => string | undefined>();

const SHAPE_KEY = /\u0001[^\u0002]*\u0002/g;

const shapeKeyed = (text: string): { readonly key: string; readonly text?: string } =>
  text.includes('\u0001') ? { key: hashOf(text.replace(SHAPE_KEY, '?')), text } : { key: hashOf(text) };

const wrapped = (canonical: string): string => (/ [|&] /.test(canonical) ? `(${canonical})` : canonical);

const canonical = (node: ts.TypeNode, file: ts.SourceFile): string => {
  if (ts.isParenthesizedTypeNode(node)) return canonical(node.type, file);
  if (ts.isUnionTypeNode(node)) return [...new Set(node.types.map((one) => canonical(one, file)))].sort().join(' | ');
  if (ts.isIntersectionTypeNode(node)) return [...new Set(node.types.map((one) => canonical(one, file)))].sort().join(' & ');
  if (ts.isTypeLiteralNode(node)) return objectOf(node.members, file);
  if (ts.isArrayTypeNode(node)) return `${wrapped(canonical(node.elementType, file))}[]`;
  if (ts.isTypeOperatorNode(node)) return `${ts.tokenToString(node.operator)} ${wrapped(canonical(node.type, file))}`;
  if (ts.isLiteralTypeNode(node)) {
    const text = literalText(node.literal);
    return text === undefined ? textOf(node, file) : JSON.stringify(text);
  }
  if (ts.isTypeReferenceNode(node)) {
    const args = node.typeArguments?.map((one) => canonical(one, file)).join(', ');
    const written = node.typeName.getText(file);
    const head = written.split('.')[0]!;
    const identity = scopes.get(file)?.(head);
    const name = identity === undefined ? written : `\u0001${identity}${written.slice(head.length)}\u0002`;
    return `${name}${args === undefined ? '' : `<${args}>`}`;
  }
  if (ts.isTupleTypeNode(node)) return `[${node.elements.map((one) => canonical(one, file)).join(', ')}]`;
  return textOf(node, file);
};

const memberOf = (member: ts.TypeElement, file: ts.SourceFile): string => {
  if (ts.isPropertySignature(member)) {
    const readonly = member.modifiers?.some((one) => one.kind === ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : '';
    const type = member.type === undefined ? 'any' : canonical(member.type, file);
    return `${readonly}${nameText(member.name, file)}${member.questionToken === undefined ? '' : '?'}: ${type}`;
  }
  return textOf(member, file);
};

const objectOf = (members: readonly ts.TypeElement[], file: ts.SourceFile): string =>
  `{ ${members
    .map((member) => memberOf(member, file))
    .sort()
    .join('; ')} }`;

const KEYWORDS = new Set([
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.NeverKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.SymbolKeyword,
]);

const keywordOnly = (node: ts.TypeNode): boolean =>
  KEYWORDS.has(node.kind) || (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword);

const generics = (parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined, file: ts.SourceFile): string =>
  parameters === undefined ? '' : `<${parameters.map((one) => textOf(one, file)).join(', ')}>`;

const labelOf = (values: readonly string[]): string => {
  const shown = values.slice(0, 5).join(', ');
  return values.length > 5 ? `${shown}, …` : shown;
};

const literalsShape = (values: readonly string[], name: string, line: number, exported: boolean): Shape => {
  const sorted = [...new Set(values)].sort();
  return { kind: 'literals', name, line, size: sorted.length, exported, key: hashOf(sorted.join('\0')), label: labelOf(sorted) };
};

const stringsOf = (array: ts.ArrayLiteralExpression): readonly string[] | undefined => {
  const values = array.elements.map((element) => literalText(element));
  return values.every((one) => one !== undefined) ? (values as string[]) : undefined;
};

const unwrapped = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current))
      current = current.expression;
    else if (ts.isTypeAssertionExpression(current)) current = current.expression;
    else if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === 'freeze' &&
      current.arguments.length === 1
    )
      current = current.arguments[0]!;
    else return current;
  }
};

const valueSet = (initializer: ts.Expression): readonly string[] | undefined => {
  const value = unwrapped(initializer);
  if (ts.isArrayLiteralExpression(value)) return stringsOf(value);
  if (ts.isNewExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'Set') {
    const first = value.arguments?.[0];
    const array = first === undefined ? undefined : unwrapped(first);
    return array !== undefined && ts.isArrayLiteralExpression(array) ? stringsOf(array) : undefined;
  }
  return undefined;
};

const literalsCall = (node: ts.CallExpression): readonly string[] | undefined => {
  const callee = node.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  const first = node.arguments[0];
  if (name !== 'Literals' || first === undefined) return undefined;
  const array = unwrapped(first);
  return ts.isArrayLiteralExpression(array) ? stringsOf(array) : undefined;
};

const exportedModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword) ?? false);

const defaultModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((one) => one.kind === ts.SyntaxKind.DefaultKeyword) ?? false);

const boundNames = (name: ts.BindingName, into: string[]): void => {
  if (ts.isIdentifier(name)) into.push(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) boundNames(element.name, into);
};

const OWN = '';

const NONE: ReadonlySet<string> = new Set();

const declaredWithin = (node: ts.Node, into: Set<string>): void =>
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child)) {
      if (child.name !== undefined) into.add(child.name.text);
      return;
    }
    if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
    if (ts.isVariableDeclaration(child)) {
      const names: string[] = [];
      boundNames(child.name, names);
      for (const name of names) into.add(name);
    }
    if (ts.isCatchClause(child) && child.variableDeclaration !== undefined) {
      const names: string[] = [];
      boundNames(child.variableDeclaration.name, names);
      for (const name of names) into.add(name);
    }
    declaredWithin(child, into);
  });

const hiddenBy = (node: ts.Node, hidden: ReadonlySet<string>): ReadonlySet<string> => {
  if (!ts.isFunctionLike(node) || ts.isTypeNode(node)) return hidden;
  const names = new Set(hidden);
  for (const parameter of node.parameters) {
    const bound: string[] = [];
    boundNames(parameter.name, bound);
    for (const name of bound) names.add(name);
  }
  if (ts.isFunctionExpression(node) && node.name !== undefined) names.add(node.name.text);
  const body = (node as ts.FunctionLikeDeclaration).body;
  if (body !== undefined) declaredWithin(body, names);
  return names;
};

const callable = (initializer: ts.Expression | undefined): boolean => {
  if (initializer === undefined) return false;
  const value = unwrapped(initializer);
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value);
};

const templatePattern = (node: ts.Expression): string | undefined => {
  const value = literalText(node);
  if (value !== undefined) return value;
  if (ts.isTemplateExpression(node))
    return `${node.head.text}${node.templateSpans.map((span) => `*${span.literal.text}`).join('')}`.replace(/\*+/g, '*');
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = templatePattern(node.left);
    return left === undefined ? undefined : `${left}${literalText(node.right) ?? '*'}`.replace(/\*+/g, '*');
  }
  return undefined;
};

type Context = { readonly within: string; readonly top: string };

const FUNCTION_METADATA: ReadonlySet<string> = new Set([
  'name',
  'length',
  'toString',
  'toLocaleString',
  'valueOf',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
]);

const nameAt = (parent: ts.Node, node: ts.Identifier): boolean => {
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isBindingElement(parent)) return parent.propertyName === node || parent.name === node;
  if (ts.isExportSpecifier(parent) || ts.isImportSpecifier(parent)) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  return (parent as { readonly name?: unknown }).name === node;
};

const read = (path: string, text: string): Facts => {
  const { blocks, template } = blocksOf(path, text);
  const exports: Exported[] = [];
  const imports: Import[] = [];
  const forwards: Forward[] = [];
  const loads: Load[] = [];
  const uses = new Set<string>();
  const shapes: Shape[] = [];
  const namespaces = new Set<string>();
  const locals = new Set<string>();
  const scriptKind = KINDS[extensionOf(path)] ?? ts.ScriptKind.TS;
  for (const block of blocks) {
    const before = exports.length;
    const shapesBefore = shapes.length;
    const listed = new Set<string>();
    const file = ts.createSourceFile(path, block.text, ts.ScriptTarget.Latest, false, scriptKind);
    const lineOf = (node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 + block.line;
    const declared = new Map<string, ExportKind>();
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) declared.set(statement.name.text, 'function');
      else if (ts.isClassDeclaration(statement) && statement.name !== undefined) declared.set(statement.name.text, 'class');
      else if (ts.isInterfaceDeclaration(statement)) declared.set(statement.name.text, 'interface');
      else if (ts.isTypeAliasDeclaration(statement)) declared.set(statement.name.text, 'type');
      else if (ts.isEnumDeclaration(statement)) declared.set(statement.name.text, 'enum');
      else if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          const names: string[] = [];
          boundNames(declaration.name, names);
          for (const name of names) declared.set(name, callable(declaration.initializer) ? 'function' : 'const');
        }
    }
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const bindings: Binding[] = [];
        const clause = statement.importClause;
        if (clause?.name !== undefined) bindings.push({ local: clause.name.text, imported: 'default' });
        const named = clause?.namedBindings;
        if (named !== undefined && ts.isNamespaceImport(named)) {
          bindings.push({ local: named.name.text, imported: '*' });
          namespaces.add(named.name.text);
        } else if (named !== undefined)
          for (const element of named.elements)
            bindings.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text });
        for (const binding of bindings) locals.add(binding.local);
        imports.push({ specifier: statement.moduleSpecifier.text, bindings });
      } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
        const specifier = literalText(statement.moduleReference.expression);
        if (specifier !== undefined) loads.push({ specifier, pattern: false });
      } else if (ts.isExportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier !== undefined ? literalText(statement.moduleSpecifier) : undefined;
        const clause = statement.exportClause;
        if (specifier !== undefined) {
          const typed = statement.isTypeOnly ? { typed: true as const } : {};
          if (clause === undefined) forwards.push({ specifier, names: 'all', ...typed });
          else if (ts.isNamespaceExport(clause))
            forwards.push({ specifier, names: [{ imported: '*', exported: clause.name.text }], ...typed });
          else
            forwards.push({
              specifier,
              names: clause.elements.map((element) => ({
                imported: (element.propertyName ?? element.name).text,
                exported: element.name.text,
                ...(element.isTypeOnly ? { typed: true as const } : {}),
              })),
              ...typed,
            });
        } else if (clause !== undefined && ts.isNamedExports(clause))
          for (const element of clause.elements) {
            listed.add((element.propertyName ?? element.name).text);
            exports.push({
              name: element.name.text,
              kind: declared.get((element.propertyName ?? element.name).text) ?? 'const',
              line: lineOf(element),
            });
          }
      }
    }
    scopes.set(file, (head) => {
      for (const one of imports) {
        const binding = one.bindings.find((entry) => entry.local === head);
        if (binding !== undefined) return `i:${one.specifier}\u0003${binding.imported}`;
      }
      return declared.has(head) ? `l:${head}` : undefined;
    });
    for (const statement of file.statements) {
      const exported = exportedModifier(statement);
      const own = (name: string, kind: ExportKind): void => {
        if (exported) exports.push({ name: defaultModifier(statement) ? 'default' : name, kind, line: lineOf(statement) });
      };
      const topName = (name: string): string => (exported ? (defaultModifier(statement) ? 'default' : name) : '');
      if (ts.isFunctionDeclaration(statement)) {
        const name = statement.name?.text ?? 'default';
        own(name, 'function');
        visit(statement, file, { within: topName(name), top: name });
      } else if (ts.isClassDeclaration(statement)) {
        const name = statement.name?.text ?? 'default';
        own(name, 'class');
        visit(statement, file, { within: topName(name), top: name });
      } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        own(statement.name.text, ts.isInterfaceDeclaration(statement) ? 'interface' : 'type');
        shape(statement);
        visit(statement, file, { within: topName(statement.name.text), top: statement.name.text });
      } else if (ts.isEnumDeclaration(statement)) {
        own(statement.name.text, 'enum');
        visit(statement, file, { within: topName(statement.name.text), top: statement.name.text });
      } else if (ts.isModuleDeclaration(statement)) {
        own(statement.name.text, 'namespace');
        visit(statement, file, { within: topName(statement.name.text), top: statement.name.text });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const names: string[] = [];
          boundNames(declaration.name, names);
          for (const name of names) own(name, callable(declaration.initializer) ? 'function' : 'const');
          const first = names[0] ?? '';
          if (declaration.initializer !== undefined) {
            const values = valueSet(declaration.initializer);
            if (values !== undefined && values.length >= 2 && ts.isIdentifier(declaration.name))
              shapes.push(literalsShape(values, first, lineOf(declaration), exported));
          }
          visit(declaration, statement, { within: exported ? first : '', top: first });
        }
      } else if (ts.isExportAssignment(statement)) {
        exports.push({ name: 'default', kind: 'default', line: lineOf(statement) });
        visit(statement.expression, statement, { within: 'default', top: 'default' });
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause))
          for (const element of statement.exportClause.elements)
            use((element.propertyName ?? element.name).text, '*', statement.isTypeOnly || element.isTypeOnly ? 't' : 'v');
      } else if (!ts.isImportDeclaration(statement) && !ts.isImportEqualsDeclaration(statement)) {
        visit(statement, file, { within: '', top: '' });
      }
    }

    function use(local: string, member: string, kind: 'v' | 't'): void {
      if (locals.has(local)) uses.add(`${local}\0${member}\0${kind}`);
    }

    function metadataUse(node: ts.Node): string | undefined {
      let target: ts.Expression | undefined;
      if (ts.isPropertyAccessExpression(node) && FUNCTION_METADATA.has(node.name.text)) target = node.expression;
      else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        FUNCTION_METADATA.has(node.argumentExpression.text)
      )
        target = node.expression;
      else if (ts.isTypeOfExpression(node)) target = node.expression;
      while (target !== undefined && (ts.isParenthesizedExpression(target) || ts.isNonNullExpression(target))) target = target.expression;
      if (target === undefined) return undefined;
      if (ts.isIdentifier(target) && locals.has(target.text) && !namespaces.has(target.text)) return `${target.text}\0*`;
      if (ts.isIdentifier(target) && !locals.has(target.text) && declared.get(target.text) === 'function') return `${OWN}\0${target.text}`;
      if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && namespaces.has(target.expression.text))
        return `${target.expression.text}\0${target.name.text}`;
      return undefined;
    }

    function shape(statement: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): void {
      const name = statement.name.text;
      const exported = exportedModifier(statement);
      const line = lineOf(statement);
      if (ts.isInterfaceDeclaration(statement)) {
        const heritage = (statement.heritageClauses ?? [])
          .flatMap((clause) => clause.types.map((one) => textOf(one, file)))
          .sort()
          .join(', ');
        const text = `${generics(statement.typeParameters, file)}${heritage === '' ? '' : ` extends ${heritage}`} ${objectOf(statement.members, file)}`;
        shapes.push({
          kind: 'object',
          name,
          line,
          size: statement.members.length,
          declaration: true,
          exported,
          ...shapeKeyed(text),
          label: labelOf(statement.members.map((member) => (member.name === undefined ? '()' : nameText(member.name, file)))),
        });
        return;
      }
      let type = statement.type;
      while (ts.isParenthesizedTypeNode(type)) type = type.type;
      let head = ts.isTypeReferenceNode(type) ? type.typeName : undefined;
      while (head !== undefined && ts.isQualifiedName(head)) head = head.left;
      const imported = head !== undefined && scopes.get(file)?.(head.text)?.startsWith('i:');
      const alias =
        (ts.isTypeReferenceNode(type) && type.typeArguments === undefined && imported) ||
        (ts.isImportTypeNode(type) && !type.isTypeOf && type.qualifier !== undefined && type.typeArguments === undefined);
      if (alias) {
        shapes.push({ kind: 'alias', name, line, size: 1, exported, declaration: true, key: hashOf(name), label: type.getText(file) });
      } else if (ts.isTypeLiteralNode(type)) {
        shapes.push({
          kind: 'object',
          name,
          line,
          size: type.members.length,
          declaration: true,
          exported,
          ...shapeKeyed(`${generics(statement.typeParameters, file)} ${objectOf(type.members, file)}`),
          label: labelOf(type.members.map((member) => (member.name === undefined ? '()' : nameText(member.name, file)))),
        });
      } else if (ts.isUnionTypeNode(type)) {
        const strings = type.types.map((one) => (ts.isLiteralTypeNode(one) ? literalText(one.literal) : undefined));
        if (strings.every((one) => one !== undefined))
          shapes.push({ ...literalsShape(strings as string[], name, line, exported), declaration: true });
        else if (!type.types.every(keywordOnly)) {
          const members = [...new Set(type.types.map((one) => canonical(one, file)))].sort();
          shapes.push({
            kind: 'union',
            name,
            line,
            size: members.length,
            declaration: true,
            exported,
            ...shapeKeyed(`${generics(statement.typeParameters, file)} ${members.join(' | ')}`),
            label: labelOf(members),
          });
        }
      }
    }

    function visit(node: ts.Node, parent: ts.Node, context: Context, typed = false, outer: ReadonlySet<string> = NONE): void {
      if (!typed && !ts.isTypeNode(node)) {
        const metadata = metadataUse(node);
        if (metadata !== undefined) {
          uses.add(`${metadata}\0m`);
          return;
        }
      }
      const hidden = hiddenBy(node, outer);
      if (ts.isIdentifier(node)) {
        if (nameAt(parent, node)) return;
        if (!locals.has(node.text)) {
          if (!typed && declared.get(node.text) === 'function' && node.text !== context.top && !hidden.has(node.text))
            uses.add(`${OWN}\0${node.text}\0v`);
          return;
        }
        const member =
          namespaces.has(node.text) && ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? parent.name.text
            : namespaces.has(node.text) && ts.isQualifiedName(parent) && parent.left === node
              ? parent.right.text
              : '*';
        uses.add(`${node.text}\0${member}\0${typed ? 't' : 'v'}`);
        return;
      }
      if (ts.isImportTypeNode(node)) {
        const argument = node.argument;
        const specifier = ts.isLiteralTypeNode(argument) ? literalText(argument.literal) : undefined;
        if (specifier !== undefined) {
          const local = `@import-type:${imports.length}`;
          let name = node.qualifier;
          while (name !== undefined && ts.isQualifiedName(name)) name = name.left;
          const imported = name?.text ?? '*';
          imports.push({ specifier, bindings: [{ local, imported }] });
          uses.add(`${local}\0*\0t`);
        }
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const first = node.arguments[0];
        if (
          first !== undefined &&
          (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require'))
        ) {
          const pattern = templatePattern(first);
          if (pattern !== undefined) loads.push({ specifier: pattern, pattern: pattern.includes('*') });
        } else if (
          first !== undefined &&
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'glob' &&
          ts.isMetaProperty(callee.expression)
        ) {
          const patterns = ts.isArrayLiteralExpression(first) ? first.elements.map(literalText) : [literalText(first)];
          for (const pattern of patterns) if (pattern !== undefined) loads.push({ specifier: pattern, pattern: true });
        }
        const values = literalsCall(node);
        if (values !== undefined && values.length >= 2)
          shapes.push(literalsShape(values, context.top, lineOf(node), context.within !== ''));
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
        const first = node.arguments?.[0];
        const specifier = first === undefined ? undefined : literalText(first);
        const second = node.arguments?.[1];
        if (specifier !== undefined && second !== undefined && second.getText(file) === 'import.meta.url')
          loads.push({ specifier: specifier.startsWith('.') ? specifier : `./${specifier}`, pattern: false });
      }
      if (ts.isClassLike(node)) {
        ts.forEachChild(node, (child) => {
          if (ts.isHeritageClause(child) && child.token === ts.SyntaxKind.ExtendsKeyword)
            for (const type of child.types) {
              visit(type.expression, type, context, typed, hidden);
              for (const argument of type.typeArguments ?? []) visit(argument, type, context, true, hidden);
            }
          else visit(child, node, context, typed, hidden);
        });
        return;
      }
      const inside = typed || ts.isTypeNode(node);
      ts.forEachChild(node, (child) => visit(child, node, context, inside, hidden));
    }
    if (!block.exports) exports.length = before;
    else
      for (let at = shapesBefore; at < shapes.length; at += 1) {
        const one = shapes[at]!;
        if (!one.exported && listed.has(one.name)) shapes[at] = { ...one, exported: true };
      }
  }
  if (template !== '')
    for (const local of locals)
      if (new RegExp(`(?<![\\w$]|[^.]\\.)${local.replace(/\$/g, '\\$')}(?![\\w$])`).test(template)) uses.add(`${local}\0*\0v`);
  return {
    exports,
    imports,
    forwards,
    loads,
    uses: [...uses].map((one): Use => {
      const [local, member, kind] = one.split('\0');
      return [local!, member!, kind === 't' || kind === 'm' ? kind : 'v'];
    }),
    shapes,
  };
};

export const factsOf = (path: string, text: string): Facts =>
  SOURCE.test(path) && !path.endsWith('.d.ts') ? read(path, text) : EMPTY_FACTS;

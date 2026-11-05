import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { jsonCodec } from '@runlith/utils/codec';
import { signatureOf } from '@tagma/inspection/signature';
import { Schema } from 'effect';
import ts from 'typescript';

const root = resolve(import.meta.dir, '../../..');
const server = join(root, 'apps/tagma/server/src');
const plugin = join(root, 'packages/tagma/src/plugin');
const ENVELOPE = { file: join(server, 'plugin-formats/tagma/contract/wire/manifest.ts'), binding: 'Envelope' };

const GENERATED = {
  points: join(plugin, 'points.generated.ts'),
  schemas: join(plugin, 'schemas.generated.json'),
  operations: join(plugin, 'operations.generated.ts'),
} as const;

type Located = { readonly name: string; readonly file: string; readonly binding: string };

type OperationShape = {
  readonly id: string;
  readonly external?: true;
  readonly input: Schema.Top;
  readonly answer: Schema.Top;
};

const sources = async (pattern: string): Promise<readonly string[]> => {
  const found: string[] = [];
  for await (const path of new Bun.Glob(pattern).scan(server)) {
    if (/\.(?:test|itest|stest|e2e|spec|bench)\.ts$/u.test(path) || path.split('/').includes('testing')) continue;
    found.push(join(server, path));
  }
  return found.sort();
};

const loaded = async (file: string, binding: string): Promise<unknown> => {
  const module: Readonly<Record<string, unknown>> = await import(file);
  if (!(binding in module)) throw new Error(`${relative(root, file)} exports no ${binding}`);
  return module[binding];
};

const schemaOf = (value: unknown, where: string): Schema.Top => {
  if (!Schema.isSchema(value)) throw new Error(`${where} is not a schema`);
  return value;
};

const printed = (schema: Schema.Top): string => signatureOf(schema).replace(/^[ \t]*\/\*\*[\s\S]*?\*\/\n/gmu, '');

const importedFrom = (source: ts.SourceFile, name: string): { readonly file: string; readonly binding: string } | null => {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const element = bindings.elements.find((one) => one.name.text === name);
    if (element === undefined) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) return null;
    return {
      file: resolve(dirname(source.fileName), specifier.replace(/\.js$/u, '.ts')),
      binding: (element.propertyName ?? element.name).text,
    };
  }
  return null;
};

const pointsIn = (file: string, text: string): readonly Located[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Located[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ContributionPoint') {
      const face = node.arguments?.[1];
      if (face !== undefined) {
        if (!ts.isObjectLiteralExpression(face)) throw new Error(`${relative(root, file)}: a plugin face must be an object literal`);
        const property = (key: string) =>
          face.properties.find(
            (one): one is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
              (ts.isPropertyAssignment(one) || ts.isShorthandPropertyAssignment(one)) && ts.isIdentifier(one.name) && one.name.text === key,
          );
        const name = property('name');
        const schema = property('schema');
        if (name === undefined || !ts.isPropertyAssignment(name) || !ts.isStringLiteral(name.initializer))
          throw new Error(`${relative(root, file)}: a plugin face names its point with a string literal`);
        const identifier = schema === undefined ? undefined : ts.isShorthandPropertyAssignment(schema) ? schema.name : schema.initializer;
        if (identifier === undefined || !ts.isIdentifier(identifier))
          throw new Error(`${relative(root, file)}: the point ${name.initializer.text} names its schema by an imported binding`);
        const origin = importedFrom(source, identifier.text);
        if (origin === null || !origin.file.includes('/contract/wire/'))
          throw new Error(
            `${relative(root, file)}: the schema of the point ${name.initializer.text} must be imported from its owner's contract/wire`,
          );
        found.push({ name: name.initializer.text, ...origin });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const declaredPoints = async (): Promise<readonly { readonly name: string; readonly schema: Schema.Top }[]> => {
  const located: Located[] = [];
  for (const file of await sources('**/*.ts')) {
    const text = await readFile(file, 'utf8');
    if (text.includes('new ContributionPoint<')) located.push(...pointsIn(file, text));
  }
  const names = new Set<string>();
  for (const { name } of located) {
    if (names.has(name)) throw new Error(`two owners declare the plugin point ${name}`);
    names.add(name);
  }
  return Promise.all(
    located
      .sort((left, right) => (left.name < right.name ? -1 : 1))
      .map(async ({ name, file, binding }) => ({
        name,
        schema: schemaOf(await loaded(file, binding), `${relative(root, file)}#${binding}`),
      })),
  );
};

const jsonSchemaOf = (schema: Schema.Top): Readonly<Record<string, unknown>> => {
  const document = Schema.toJsonSchemaDocument(jsonCodec(schema), { onExcessProperty: 'error' });
  return Object.keys(document.definitions).length === 0 ? document.schema : { ...document.schema, $defs: document.definitions };
};

const pluginTexts = async (): Promise<{ readonly points: string; readonly schemas: string }> => {
  const points = await declaredPoints();
  const envelope = schemaOf(await loaded(ENVELOPE.file, ENVELOPE.binding), 'the plugin manifest envelope');
  const indent = (text: string) => text.replaceAll('\n', '\n  ');
  return {
    points: [
      `export type PluginEnvelope = ${printed(envelope)};`,
      '',
      'export type PluginPoints = {',
      ...points.map(({ name, schema }) => `  readonly ${name}: ${indent(printed(schema))};`),
      '};',
      '',
      `export const POINT_NAMES = [${points.map(({ name }) => `'${name}'`).join(', ')}] as const satisfies readonly (keyof PluginPoints)[];`,
      '',
    ].join('\n'),
    schemas: `${JSON.stringify(
      { envelope: jsonSchemaOf(envelope), points: Object.fromEntries(points.map(({ name, schema }) => [name, jsonSchemaOf(schema)])) },
      null,
      2,
    )}\n`,
  };
};

const isOperation = (value: unknown): value is OperationShape =>
  typeof value === 'object' && value !== null && 'id' in value && 'input' in value && 'answer' in value;

const operationsText = async (): Promise<string> => {
  const { knownAnswer } = (await import(join(server, 'platform/contract/wire/operation.ts'))) as {
    readonly knownAnswer: (answer: Schema.Top) => Schema.Top;
  };
  const external = new Map<string, OperationShape>();
  for (const file of await sources('**/contract/wire/module.ts')) {
    const module: Readonly<Record<string, unknown>> = await import(file);
    for (const wire of Object.values(module)) {
      const load = (wire as { readonly operations?: unknown } | null)?.operations;
      if (typeof load !== 'function') continue;
      const { declarations } = (await load()) as { readonly declarations: Readonly<Record<string, unknown>> };
      for (const declaration of Object.values(declarations))
        if (isOperation(declaration) && declaration.external === true) external.set(declaration.id, declaration);
    }
  }
  const indent = (text: string) => text.replaceAll('\n', '\n    ');
  return [
    'export type ExternalOperations = {',
    ...[...external.keys()].sort().flatMap((id) => {
      const declaration = external.get(id)!;
      return [
        `  readonly ${id}: {`,
        `    readonly input: ${indent(printed(declaration.input))};`,
        `    readonly answer: ${indent(printed(knownAnswer(declaration.answer)))};`,
        '  };',
      ];
    }),
    '};',
    '',
  ].join('\n');
};

const canonicalTs = (text: string): string => {
  const parts: string[] = [];
  const visit = (node: ts.Node): void => {
    parts.push(ts.SyntaxKind[node.kind]!);
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isPrivateIdentifier(node))
      parts.push(JSON.stringify(node.text));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('generated.ts', text, ts.ScriptTarget.Latest, true));
  return parts.join(' ');
};

const sameGenerated = (path: string, written: string, expected: string): boolean =>
  path.endsWith('.json') ? Bun.deepEquals(JSON.parse(written), JSON.parse(expected)) : canonicalTs(written) === canonicalTs(expected);

export const syncGenerated = async ({ write }: { readonly write: boolean }): Promise<readonly string[]> => {
  const { points, schemas } = await pluginTexts();
  const texts: readonly [string, string][] = [
    [GENERATED.points, points],
    [GENERATED.schemas, schemas],
    [GENERATED.operations, await operationsText()],
  ];
  const changed: string[] = [];
  for (const [path, text] of texts) {
    const standing = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (standing !== null && sameGenerated(path, standing, text)) continue;
    if (write) await writeFile(path, text);
    changed.push(relative(root, path));
  }
  return changed;
};

if (import.meta.main) {
  const changed = await syncGenerated({ write: true });
  console.log(changed.length === 0 ? 'The plugin SDK’s generated files are current.' : `Wrote ${changed.join(', ')}.`);
}

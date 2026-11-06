import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { signatureOf } from '@tagma/inspection/signature';
import { Schema } from 'effect';
import ts from 'typescript';
import { FACADE, uiFacade } from './ui.js';

const root = resolve(import.meta.dir, '../../..');
const POINT_MARK = 'new ContributionPoint<';
const cache = (): string => join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'tagma-kit');
const KEPT = 8;
const RESOLUTION_FILES = ['package.json', 'tsconfig.json', 'bunfig.toml'];
const server = join(root, 'apps/tagma/server/src');
const plugin = join(root, 'packages/tagma/src/plugin');
const ENVELOPE = { file: join(server, 'plugin-formats/tagma/contract/wire/manifest.ts'), binding: 'Envelope' };
const CONTRIBUTIONS = { file: join(server, 'plugins/contract/wire/contributions.ts'), binding: 'contributionsRefusal' };
const LABEL = { file: join(server, 'plugins/contract/wire/names.ts'), binding: 'PluginLabel' };
const GRAPH = { file: join(server, 'views/contract/wire/graph.ts'), binding: 'ViewGraph' };
const TOOL_STATE = { file: join(server, 'threads/contract/wire/transcript.ts'), binding: 'TranscriptToolState' };
const COMPILE = join(server, 'views/contract/wire/compile.ts');
const HOST = join(server, 'views/contract/wire/host.ts');

const GENERATED = {
  points: join(plugin, 'points.generated.ts'),
  checks: join(plugin, 'checks.generated.js'),
  checksTypes: join(plugin, 'checks.generated.d.ts'),
  operations: join(plugin, 'operations.generated.ts'),
  ui: FACADE,
} as const;

type Located = { readonly name: string; readonly file: string; readonly binding: string };

type OperationShape = {
  readonly id: string;
  readonly external?: true | 'own';
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

const facesIn = (file: string, text: string): readonly Located[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Located[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ContributionPoint') {
      const face = node.arguments?.[1];
      if (face !== undefined) {
        const origin = ts.isIdentifier(face) ? importedFrom(source, face.text) : null;
        if (origin === null || !origin.file.includes('/contract/wire/'))
          throw new Error(
            `${relative(root, file)}: a plugin face is declared in its owner's contract/wire and passed by its imported name`,
          );
        found.push({ name: origin.binding, ...origin });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

type Answer = { readonly name: string; readonly schema: Schema.Top };

type Face = {
  readonly name: string;
  readonly schema: Schema.Top;
  readonly answer: Answer | null;
  readonly file: string;
  readonly binding: string;
};

const answerOf = (value: unknown, where: string): Answer | null => {
  if (value === undefined) return null;
  const { name, schema } = value as { readonly name?: unknown; readonly schema?: unknown };
  if (typeof name !== 'string') throw new Error(`${where} names no type`);
  return { name, schema: schemaOf(schema, `${where}.schema`) };
};

const faceOf = (value: unknown, where: string): Omit<Face, 'file' | 'binding'> => {
  const { name, schema, answer } = (value ?? {}) as { readonly name?: unknown; readonly schema?: unknown; readonly answer?: unknown };
  if (typeof name !== 'string') throw new Error(`${where} names no point`);
  return { name, schema: schemaOf(schema, `${where}.schema`), answer: answerOf(answer, `${where}.answer`) };
};

const declaredFaces = async (): Promise<readonly Face[]> => {
  const located: Located[] = [];
  for (const file of await sources('**/*.ts')) {
    const text = await readFile(file, 'utf8');
    if (text.includes(POINT_MARK)) located.push(...facesIn(file, text));
  }
  const faces = await Promise.all(
    located.map(async ({ file, binding }) => ({
      ...faceOf(await loaded(file, binding), `${relative(root, file)}#${binding}`),
      file,
      binding,
    })),
  );
  const names = new Set<string>();
  for (const { name } of faces) {
    if (names.has(name)) throw new Error(`two owners declare the plugin point ${name}`);
    names.add(name);
  }
  return faces.sort((left, right) => (left.name < right.name ? -1 : 1));
};

const pointsText = async (faces: readonly Face[]): Promise<string> => {
  const envelope = schemaOf(await loaded(ENVELOPE.file, ENVELOPE.binding), 'the plugin manifest envelope');
  const graph = schemaOf(await loaded(GRAPH.file, GRAPH.binding), 'the view graph');
  const toolState = schemaOf(await loaded(TOOL_STATE.file, TOOL_STATE.binding), 'the transcript tool state');
  const indent = (text: string) => text.replaceAll('\n', '\n  ');
  return [
    `export type PluginEnvelope = ${signatureOf(envelope)};`,
    '',
    'export type PluginPoints = {',
    ...faces.map(({ name, schema }) => `  readonly ${name}: ${indent(signatureOf(schema))};`),
    '};',
    '',
    ...faces.flatMap(({ answer }) => (answer === null ? [] : [`export type ${answer.name} = ${signatureOf(answer.schema)};`, ''])),
    `export type ViewGraph = ${signatureOf(graph)};`,
    '',
    `export type ToolFaceState = ${signatureOf(toolState)};`,
    '',
    `export const POINT_NAMES = [${faces.map(({ name }) => `'${name}'`).join(', ')}] as const satisfies readonly (keyof PluginPoints)[];`,
    '',
  ].join('\n');
};

const CHECKS_ENTRY = 'tagma-checks:entry';

const checksEntry = (faces: readonly Face[]): string =>
  [
    "import { Result, Schema } from 'effect';",
    `import { ${CONTRIBUTIONS.binding} } from ${JSON.stringify(CONTRIBUTIONS.file)};`,
    `import { ${ENVELOPE.binding} } from ${JSON.stringify(ENVELOPE.file)};`,
    `import { ${LABEL.binding} } from ${JSON.stringify(LABEL.file)};`,
    `import { ${GRAPH.binding} } from ${JSON.stringify(GRAPH.file)};`,
    `export { GRAPH_FILE, VIEW_GRAPH } from ${JSON.stringify(GRAPH.file)};`,
    `export { viewCompileOptions, viewModuleOptions } from ${JSON.stringify(COMPILE)};`,
    `export { hostModules, UI_MODULE } from ${JSON.stringify(HOST)};`,
    ...faces.map((face, at) => `import { ${face.binding} as face${at} } from ${JSON.stringify(face.file)};`),
    `const faces = new Map([${faces.map((_, at) => `face${at}`).join(', ')}].map((face) => [face.name, face]));`,
    `const decodeEnvelope = Schema.decodeUnknownResult(${ENVELOPE.binding});`,
    `const decodeId = Schema.decodeUnknownResult(${LABEL.binding});`,
    `const decodeGraph = Schema.decodeUnknownResult(${GRAPH.binding});`,
    'export const graphRefusal = (graph: unknown): string | null => {',
    "  const decoded = decodeGraph(graph, { onExcessProperty: 'error' });",
    '  return Result.isFailure(decoded) ? decoded.failure.message : null;',
    '};',
    'export const manifestRefusal = (manifest: unknown): string | null => {',
    "  const decoded = decodeEnvelope(manifest, { onExcessProperty: 'error' });",
    '  if (Result.isFailure(decoded)) return decoded.failure.message;',
    `  const checked = ${CONTRIBUTIONS.binding}(decoded.success.id, faces, decoded.success.contributes ?? {});`,
    '  return Result.isFailure(checked) ? checked.failure : null;',
    '};',
    'export const pluginIdRefusal = (id: unknown): string | null => {',
    '  const decoded = decodeId(id);',
    '  return Result.isFailure(decoded) ? decoded.failure.message : null;',
    '};',
    '',
  ].join('\n');

const inputsOf = (metafile: unknown): readonly string[] =>
  Object.keys((metafile as { readonly inputs?: Readonly<Record<string, unknown>> } | undefined)?.inputs ?? {})
    .map((key) => (isAbsolute(key) ? key : resolve(key)))
    .filter((file) => file.startsWith(`${root}/`) && !file.includes('/node_modules/') && existsSync(file))
    .map((file) => relative(root, file));

const checksText = async (faces: readonly Face[]): Promise<{ readonly text: string; readonly inputs: readonly string[] }> => {
  const result = await Bun.build({
    metafile: true,
    entrypoints: [CHECKS_ENTRY],
    plugins: [
      {
        name: 'tagma-checks',
        setup: (build) => {
          build.onResolve({ filter: /^tagma-checks:entry$/u }, () => ({ path: CHECKS_ENTRY, namespace: 'tagma-checks' }));
          build.onLoad({ filter: /.*/u, namespace: 'tagma-checks' }, () => ({
            loader: 'ts',
            resolveDir: server,
            contents: checksEntry(faces),
          }));
        },
      },
    ],
    target: 'bun',
    format: 'esm',
    external: ['effect', 'effect/*'],
    minify: { whitespace: true, syntax: true },
    throw: false,
  } as Parameters<typeof Bun.build>[0]);
  const [output] = result.outputs;
  if (!result.success || output === undefined) throw new Error(`the plugin checks did not bundle: ${result.logs.map(String).join('\n')}`);
  return {
    text: `${(await output.text()).replace(/^\/\/ @bun\n/u, '').trim()}\n`,
    inputs: inputsOf((result as { readonly metafile?: unknown }).metafile),
  };
};

const CHECKS_TYPES = [
  "import type { CompileOptions, ModuleCompileOptions } from 'svelte/compiler';",
  '',
  'export declare const manifestRefusal: (manifest: unknown) => string | null;',
  '',
  'export declare const pluginIdRefusal: (id: unknown) => string | null;',
  '',
  'export declare const graphRefusal: (graph: unknown) => string | null;',
  '',
  "export declare const VIEW_GRAPH: 'dist/ui';",
  "export declare const GRAPH_FILE: 'graph.json';",
  'export declare const UI_MODULE: string;',
  'export declare const viewCompileOptions: (path: string, dependency: boolean) => CompileOptions;',
  'export declare const viewModuleOptions: (path: string) => ModuleCompileOptions;',
  'export declare const hostModules: (svelteExports: Readonly<Record<string, unknown>>) => readonly string[];',
  '',
].join('\n');

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
        if (isOperation(declaration) && declaration.external !== undefined) external.set(declaration.id, declaration);
    }
  }
  const indent = (text: string) => text.replaceAll('\n', '\n    ');
  return [
    'export type ExternalOperations = {',
    ...[...external.keys()].sort().flatMap((id) => {
      const declaration = external.get(id)!;
      return [
        `  readonly ${id}: {`,
        `    readonly input: ${indent(signatureOf(declaration.input))};`,
        `    readonly answer: ${indent(signatureOf(knownAnswer(declaration.answer)))};`,
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
  const docs = [...text.matchAll(/\/\*\*[\s\S]*?\*\//gu)].map((doc) => doc[0].replace(/\s+/gu, ' '));
  const directives = [...text.matchAll(/^\/\/\/.*$/gmu)].map((one) => one[0]);
  return [...parts, ...docs, ...directives].join(' ');
};

const sameGenerated = (written: string, expected: string): boolean => canonicalTs(written) === canonicalTs(expected);

type Manifest = { readonly files: readonly string[]; readonly digest: string };

const GENERATOR = [import.meta.path, join(import.meta.dir, 'ui.ts'), join(root, 'packages/tagma/src/plugin/svelteProgram.ts')];

const absent = (error: NodeJS.ErrnoException): null => {
  if (error.code === 'ENOENT') return null;
  throw error;
};

const digestOf = async (files: readonly string[]): Promise<string> => {
  const sorted = [...files].sort();
  const contents = await Promise.all(sorted.map((file) => readFile(join(root, file)).catch(absent)));
  const hash = createHash('sha256');
  for (const [at, file] of sorted.entries())
    hash
      .update(`${file}\0`)
      .update(contents[at] ?? '\0absent')
      .update('\0');
  return hash.digest('hex');
};

const manifestAt = async (): Promise<string> =>
  join(cache(), `${await digestOf(Object.values(GENERATED).map((file) => relative(root, file)))}.json`);

const manifestRead = async (path: string): Promise<Manifest | null> => {
  const text = await readFile(path, 'utf8').catch(absent);
  if (text === null) return null;
  const value = JSON.parse(text) as Partial<Manifest>;
  return Array.isArray(value.files) && typeof value.digest === 'string' ? { files: value.files, digest: value.digest } : null;
};

const recordedCurrent = async (): Promise<boolean> => {
  const path = await manifestAt();
  const manifest = await manifestRead(path);
  if (manifest === null) return false;
  const listed = new Set(manifest.files);
  for (const file of await sources('**/*.ts')) {
    if (listed.has(relative(root, file))) continue;
    if (file.endsWith('/contract/wire/module.ts') || (await readFile(file, 'utf8')).includes(POINT_MARK)) return false;
  }
  if ((await digestOf(manifest.files)) !== manifest.digest) return false;
  const now = new Date();
  await utimes(path, now, now).catch(absent);
  return true;
};

const resolutionOf = (files: readonly string[]): readonly string[] => {
  const found: string[] = [];
  const walked = new Set<string>();
  for (const file of files)
    for (let directory = dirname(file); !walked.has(directory); directory = dirname(directory)) {
      walked.add(directory);
      for (const name of RESOLUTION_FILES) if (existsSync(join(root, directory, name))) found.push(join(directory, name));
      if (directory === '.') break;
    }
  return found;
};

const pruned = async (directory: string): Promise<void> => {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  const aged = await Promise.all(
    names.map(async (name) => ({ name, at: (await stat(join(directory, name)).catch(absent))?.mtimeMs ?? 0 })),
  );
  for (const { name } of aged.sort((left, right) => right.at - left.at).slice(KEPT)) await rm(join(directory, name), { force: true });
};

const manifestWritten = async (ui: readonly string[], checks: readonly string[]): Promise<void> => {
  const modules = await sources('**/contract/wire/module.ts');
  const points: string[] = [];
  for (const file of await sources('**/*.ts')) if ((await readFile(file, 'utf8')).includes(POINT_MARK)) points.push(file);
  const imported = Object.keys(require.cache).filter((file) => file.startsWith(`${root}/`) && existsSync(file));
  const read = [
    ...new Set([
      ...checks,
      ...[...imported, ...ui, ...points, ...modules, ...GENERATOR]
        .filter((file) => !file.includes('/node_modules/'))
        .map((file) => relative(root, file)),
      'bun.lock',
    ]),
  ].filter((file) => !file.startsWith('..'));
  const files = [...new Set([...read, ...resolutionOf(read)])];
  const path = await manifestAt();
  await mkdir(dirname(path), { recursive: true });
  const written = `${path}.${process.pid}.${Date.now()}`;
  await writeFile(written, JSON.stringify({ files, digest: await digestOf(files) } satisfies Manifest));
  await rename(written, path);
  await pruned(dirname(path));
};

export const syncGenerated = async ({
  write,
}: {
  readonly write: boolean;
}): Promise<{ readonly changed: readonly string[]; readonly recorded: boolean }> => {
  if (write && (await recordedCurrent())) return { changed: [], recorded: true };
  const faces = await declaredFaces();
  const checks = await checksText(faces);
  const ui = uiFacade();
  const texts: readonly [string, string][] = [
    [GENERATED.points, await pointsText(faces)],
    [GENERATED.checks, checks.text],
    [GENERATED.checksTypes, CHECKS_TYPES],
    [GENERATED.operations, await operationsText()],
    [GENERATED.ui, ui.text],
  ];
  const changed: string[] = [];
  for (const [path, text] of texts) {
    const standing = await readFile(path, 'utf8').catch(absent);
    if (standing !== null && sameGenerated(standing, text)) continue;
    if (write) await writeFile(path, text);
    changed.push(relative(root, path));
  }
  if (write || changed.length === 0) await manifestWritten(ui.files, checks.inputs);
  return { changed, recorded: false };
};

if (import.meta.main) {
  const { changed, recorded } = await syncGenerated({ write: true });
  console.log(
    recorded
      ? 'The plugin SDK’s generated files are current: no file the last generation read has changed.'
      : changed.length === 0
        ? 'The plugin SDK’s generated files are current.'
        : `Wrote ${changed.join(', ')}.`,
  );
}

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { BunPlugin } from 'bun';
import ts from 'typescript';
import { hostSpecifiers, workspaceManifests } from '../src/adapter/hostModules';
import { syncGenerated } from './generated';
import { emitRules } from './rules';

const packageRoot = resolve(import.meta.dir, '..');
const root = resolve(packageRoot, '../..');
const out = join(packageRoot, 'dist');
await rm(out, { recursive: true, force: true });
await syncGenerated({ write: true });
const texts = await workspaceManifests(root);
const manifests = new Map(
  texts.map((text) => {
    const manifest = JSON.parse(text);
    return [manifest.name as string, manifest];
  }),
);
const specifiers = hostSpecifiers(texts);
const hostEntry = join(import.meta.dir, 'host.generated.ts');
const hostText = `export const host = {\n${specifiers.map((specifier) => `  ${JSON.stringify(specifier)}: () => import(${JSON.stringify(specifier)}),`).join('\n')}\n};\n`;
const previousHost = await readFile(hostEntry, 'utf8').catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (previousHost !== hostText) await writeFile(hostEntry, hostText);
const manifest = manifests.get('@runlith/tagma');
type Conditions = { readonly types: string; readonly browser?: string; readonly default: string | null };
const CREATE = './adapter/create';
const PLUGIN_DOOR = /^\.\/(?:plugin(?:\/|$)|testing$)/u;
const CLI = join(packageRoot, manifest.bin['tagma-plugin']);
const doors = Object.entries(manifest.exports as Readonly<Record<string, Conditions>>)
  .filter(([key]) => (key.startsWith('./adapter/') && key !== CREATE) || PLUGIN_DOOR.test(key))
  .map(([key, conditions]) => ({ key, conditions, source: join(packageRoot, conditions.types) }));
const adapterDoors = doors.filter((door) => door.key.startsWith('./adapter/'));
const pluginDoors = doors.filter((door) => PLUGIN_DOOR.test(door.key));
const builtFile = (source: string): string => `./${relative(join(packageRoot, 'src'), source).replace(/\.ts$/u, '')}`;
const ruleDoors = Object.entries(manifest.exports as Readonly<Record<string, Conditions>>)
  .filter(([key]) => key === './rules' || key.startsWith('./rules/'))
  .map(([key, conditions]) => ({ key, source: join(packageRoot, conditions.types) }));
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  declaration: true,
  emitDeclarationOnly: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  strict: true,
  types: ['bun'],
};
const host = ts.createCompilerHost(options);
type Exported = string | null | { readonly bun?: string | null; readonly types?: string | null; readonly default?: string | null };
const exportedAt = (
  exports: Readonly<Record<string, Exported>>,
  key: string,
): { readonly exported: Exported; readonly star: string } | undefined => {
  if (Object.hasOwn(exports, key)) return { exported: exports[key]!, star: '' };
  const patterns = Object.keys(exports)
    .filter((pattern) => {
      const [prefix, suffix] = pattern.split('*') as [string, string | undefined];
      return suffix !== undefined && key.length >= prefix.length + suffix.length && key.startsWith(prefix) && key.endsWith(suffix);
    })
    .sort((left, right) => right.indexOf('*') - left.indexOf('*'));
  const pattern = patterns[0];
  if (pattern === undefined) return undefined;
  const [prefix, suffix] = pattern.split('*') as [string, string];
  return { exported: exports[pattern]!, star: key.slice(prefix.length, key.length - suffix.length) };
};
const workspaceFile = (specifier: string): string | undefined => {
  const name = specifier.split('/').slice(0, 2).join('/');
  const manifest = manifests.get(name);
  if (manifest === undefined) return undefined;
  const found = exportedAt(manifest.exports ?? {}, `.${specifier.slice(name.length)}`);
  const exported = found?.exported;
  const entry = typeof exported === 'string' ? exported : (exported?.bun ?? exported?.types ?? exported?.default);
  if (typeof entry !== 'string') throw new Error(`No type surface for ${specifier}`);
  return join(root, 'packages', name.slice('@runlith/'.length), entry.replace('*', found!.star));
};
const resolveModule = (specifier: string, file: string): string | undefined =>
  workspaceFile(specifier) ?? ts.resolveModuleName(specifier, file, options, host).resolvedModule?.resolvedFileName;

host.resolveModuleNames = (names, file) =>
  names.map((name) => {
    const workspace = workspaceFile(name);
    return workspace === undefined
      ? ts.resolveModuleName(name, file, options, host).resolvedModule
      : { resolvedFileName: workspace, extension: ts.Extension.Ts };
  });
const roots = doors.map((door) => door.source);
const publicRoots = new Set(roots);
const rooted = new Set(roots);
const names = new Map(doors.map((door) => [door.source, `@runlith/tagma${door.key.slice(1)}`]));
for (const specifier of specifiers) {
  if (specifier === 'effect' || specifier.startsWith('effect/')) continue;
  const file = resolveModule(specifier, roots[0]!);
  if (file === undefined) throw new Error(`Cannot resolve host module ${specifier}`);
  names.set(file, specifier);
  if (!rooted.has(file)) {
    rooted.add(file);
    roots.push(file);
  }
}
const declarations = new Map<string, string>();
const program = ts.createProgram(roots, options, host);
const emitted = program.emit(
  undefined,
  (_file, text, _bom, _error, sources) => {
    if (sources?.length !== 1) throw new Error('A declaration has no source owner');
    declarations.set(sources[0]!.fileName, text);
  },
  undefined,
  true,
);
if (emitted.emitSkipped || emitted.diagnostics.length > 0)
  throw new Error(ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, host));

const internalName = (file: string): string => {
  const known = names.get(file);
  if (known !== undefined) return known;
  const path = relative(root, file)
    .replace(/\\/g, '/')
    .replace(/\.(?:d\.)?[cm]?tsx?$/, '');
  const name = `@runlith/tagma/internal/${path}`;
  names.set(file, name);
  return name;
};
const pending = [...declarations.keys()];
const queued = new Set(pending);
const rewritten = new Map<string, string>();
for (let index = 0; index < pending.length; index++) {
  const file = pending[index]!;
  const text = declarations.get(file) ?? (await readFile(file, 'utf8'));
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rewrite = (specifier: string): string => {
    if (specifier === 'effect' || specifier.startsWith('effect/') || specifier.startsWith('node:')) return specifier;
    const target = resolveModule(specifier, file);
    if (target === undefined) throw new Error(`Cannot resolve declaration import ${specifier} from ${file}`);
    if (!queued.has(target)) {
      queued.add(target);
      pending.push(target);
    }
    return internalName(target);
  };
  const transformed = ts.transform(source, [
    (context) => {
      const visit: ts.Visitor = (node) => {
        if (node.kind === ts.SyntaxKind.DeclareKeyword && !publicRoots.has(file)) return undefined;
        if (
          ts.isStringLiteral(node) &&
          ((ts.isImportDeclaration(node.parent) && node.parent.moduleSpecifier === node) ||
            (ts.isExportDeclaration(node.parent) && node.parent.moduleSpecifier === node) ||
            (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent) && node.parent.parent.argument === node.parent))
        )
          return ts.factory.createStringLiteral(rewrite(node.text));
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    },
  ]);
  rewritten.set(file, ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0]!));
  transformed.dispose();
}
await mkdir(out, { recursive: true });
const nodeDeclaration = program.getSourceFiles().find((file) => file.fileName.endsWith('/@types/node/index.d.ts'));
if (nodeDeclaration === undefined) throw new Error('The build needs the Node declarations supplied by @types/bun');
const nodeTypes = dirname(nodeDeclaration.fileName);
const undiciDeclaration = ts.resolveModuleName('undici-types', nodeDeclaration.fileName, options, host).resolvedModule;
if (undiciDeclaration === undefined) throw new Error('The Node declarations need undici-types');
const undiciTypes = dirname(undiciDeclaration.resolvedFileName);
const nodeTarget = join(out, 'types/node');
const undiciTarget = join(out, 'types/undici');
const copyDeclarations = async (origin: string, destination: string): Promise<void> => {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(origin, { withFileTypes: true })) {
    const sourcePath = join(origin, entry.name);
    const targetPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDeclarations(sourcePath, targetPath);
      continue;
    }
    if (!entry.name.endsWith('.d.ts')) continue;
    const relativeEntry = (target: string): string => {
      const path = relative(dirname(targetPath), target).replace(/\\/g, '/');
      return path.startsWith('.') ? path : `./${path}`;
    };
    const text = (await readFile(sourcePath, 'utf8')).replace(
      /\/\/\/\s*<reference\s+types=["']node["']\s*\/?>/g,
      `/// <reference path="${relativeEntry(join(nodeTarget, 'index.d.ts'))}" />`,
    );
    const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transformed = ts.transform(source, [
      (context) => {
        const visit = (node: ts.Node, aliases: ReadonlyMap<string, string>): ts.VisitResult<ts.Node | undefined> => {
          if (ts.isModuleBlock(node)) {
            const local = new Map(aliases);
            for (const statement of node.statements) {
              if (
                !ts.isImportDeclaration(statement) ||
                !ts.isStringLiteral(statement.moduleSpecifier) ||
                statement.moduleSpecifier.text !== 'undici-types'
              )
                continue;
              const bindings = statement.importClause?.namedBindings;
              if (bindings === undefined || !ts.isNamedImports(bindings))
                throw new Error('An ambient HTTP declaration needs named imports');
              for (const binding of bindings.elements) local.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
            }
            return ts.visitEachChild(node, (child) => visit(child, local), context);
          }
          if (
            ts.isImportDeclaration(node) &&
            ts.isModuleBlock(node.parent) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            node.moduleSpecifier.text === 'undici-types'
          )
            return undefined;
          const imported =
            ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
              ? aliases.get(node.typeName.text)
              : ts.isTypeQueryNode(node) && ts.isIdentifier(node.exprName)
                ? aliases.get(node.exprName.text)
                : undefined;
          if (imported !== undefined)
            return ts.factory.createImportTypeNode(
              ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(relativeEntry(join(undiciTarget, 'index')))),
              undefined,
              ts.factory.createIdentifier(imported),
              ts.isTypeReferenceNode(node) ? node.typeArguments : undefined,
              ts.isTypeQueryNode(node),
            );
          if (
            ts.isStringLiteral(node) &&
            node.text === 'undici-types' &&
            (ts.isImportDeclaration(node.parent) ||
              ts.isExportDeclaration(node.parent) ||
              (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent) && node.parent.parent.argument === node.parent))
          )
            return ts.factory.createStringLiteral(relativeEntry(join(undiciTarget, 'index')));
          return ts.visitEachChild(node, (child) => visit(child, aliases), context);
        };
        return (node) => ts.visitNode(node, (child) => visit(child, new Map())) as ts.SourceFile;
      },
    ]);
    await writeFile(targetPath, ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0]!));
    transformed.dispose();
  }
};
await copyDeclarations(nodeTypes, nodeTarget);
await copyDeclarations(undiciTypes, undiciTarget);
const ambient = [...rewritten]
  .filter(([file]) => !publicRoots.has(file))
  .map(([file, text]) => `declare module ${JSON.stringify(internalName(file))} {\n${text}\n}`)
  .join('\n');
await writeFile(join(out, 'host.d.ts'), ambient);
for (const door of doors) {
  const target = join(out, `${builtFile(door.source)}.d.ts`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    `/// <reference path="../types/node/index.d.ts" />\n/// <reference path="../host.d.ts" />\n${rewritten.get(door.source)}`,
  );
}
const workspaceHost: BunPlugin = {
  name: 'workspace-host',
  setup(build) {
    build.onResolve({ filter: /^@runlith\// }, ({ path }) => {
      const file = workspaceFile(path);
      if (file === undefined) throw new Error(`Unknown workspace host module ${path}`);
      return { path: file };
    });
  },
};
const runtime = await Bun.build({
  entrypoints: adapterDoors.map((door) => door.source),
  outdir: join(out, 'adapter'),
  naming: '[name].js',
  target: 'bun',
  external: ['effect', 'effect/*'],
  minify: true,
  plugins: [workspaceHost],
});
if (!runtime.success) throw new AggregateError(runtime.logs, 'The author kit did not build');
const plugins = await Bun.build({
  entrypoints: [...pluginDoors.map((door) => door.source), CLI],
  root: join(packageRoot, 'src'),
  outdir: out,
  naming: { entry: '[dir]/[name].js', chunk: 'plugin/[name]-[hash].js' },
  target: 'bun',
  splitting: true,
  external: ['typescript'],
  minify: true,
  plugins: [workspaceHost],
});
if (!plugins.success) throw new AggregateError(plugins.logs, 'The plugin doors did not build');
const cli = join(out, `${builtFile(CLI)}.js`);
const cliText = await readFile(cli, 'utf8');
if (!cliText.startsWith('#!')) await writeFile(cli, `#!/usr/bin/env bun\n${cliText}`);
await emitRules(out, ruleDoors);
await mkdir(join(out, 'kit'), { recursive: true });
await cp(join(import.meta.dir, 'create.ts'), join(out, 'kit/create.ts'));
await cp(join(import.meta.dir, 'template'), join(out, 'kit/template'), { recursive: true });
await writeFile(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      private: true,
      license: 'UNLICENSED',
      type: 'module',
      exports: {
        ...Object.fromEntries(
          ruleDoors.map(({ key, source }) => {
            const file = `./rules/${basename(source, '.ts')}`;
            return [key, { types: `${file}.d.ts`, default: `${file}.js` }];
          }),
        ),
        ...Object.fromEntries(
          doors.map(({ key, conditions, source }) => {
            const file = builtFile(source);
            return [
              key,
              {
                types: `${file}.d.ts`,
                ...(conditions.browser === undefined ? {} : { browser: `${file}.js` }),
                ...(conditions.default === null ? { bun: `${file}.js`, default: null } : { default: `${file}.js` }),
              },
            ];
          }),
        ),
        [CREATE]: { types: './kit/create.ts', bun: './kit/create.ts', default: null },
      },
      bin: { create: './kit/create.ts', 'tagma-plugin': `${builtFile(CLI)}.js` },
      files: ['rules', 'adapter', 'plugin', 'host.d.ts', 'types', 'kit/create.ts', 'kit/template'],
      dependencies: { typescript: `^${ts.version}` },
      peerDependencies: { effect: manifest.peerDependencies.effect },
      peerDependenciesMeta: { effect: { optional: true } },
    },
    null,
    2,
  ),
);
const creator = join(out, 'create-tagma-adapter');
await mkdir(join(creator, 'kit'), { recursive: true });
await cp(join(import.meta.dir, 'create.ts'), join(creator, 'kit/create.ts'));
await cp(join(import.meta.dir, 'template'), join(creator, 'kit/template'), { recursive: true });
await writeFile(
  join(creator, 'package.json'),
  JSON.stringify(
    { name: '@runlith/create-tagma-adapter', version: manifest.version, private: true, type: 'module', bin: { create: './kit/create.ts' } },
    null,
    2,
  ),
);
console.log(
  `Built ${ruleDoors.length + doors.length} SDK entries, ${specifiers.length} host declarations (${rewritten.size} modules) and the bun create package.`,
);

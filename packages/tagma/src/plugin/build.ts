import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BunPlugin } from 'bun';
import ts from 'typescript';
import { manifestRefusal } from './checks.generated.js';
import { describePlugin, manifestOf, PluginInvalid, PROCESS_ENTRY } from './describe.js';
import type { PluginDefinition } from './plugin.js';
import type { PluginEnvelope } from './points.generated.js';

export const MANIFEST = 'tagma-plugin.json';

const DEFINITION = 'plugin.ts';

const NAMESPACE = 'tagma-plugin';

const ENTRY = `${NAMESPACE}:process`;

const isMetaRequire = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'require' &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

const computedImports = (code: string): number => {
  const source = ts.createSourceFile('process.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const requires = new Set<string>();
  const aliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isMetaRequire(node.initializer))
      requires.add(node.name.text);
    ts.forEachChild(node, aliases);
  };
  aliases(source);
  let computed = 0;
  const calls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const loads =
        callee.kind === ts.SyntaxKind.ImportKeyword || isMetaRequire(callee) || (ts.isIdentifier(callee) && requires.has(callee.text));
      const [specifier] = node.arguments;
      if (loads && (specifier === undefined || !ts.isStringLiteralLike(specifier))) computed += 1;
    }
    ts.forEachChild(node, calls);
  };
  calls(source);
  return computed;
};

type BuildStep = 'package' | 'types' | 'definition' | 'bundle' | 'check';

export class BuildFailed extends Error {
  constructor(
    readonly step: BuildStep,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'BuildFailed';
  }
}

type Built = { readonly manifest: PluginEnvelope; readonly process: boolean };

const versionOf = async (directory: string): Promise<string> => {
  const path = join(directory, 'package.json');
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new BuildFailed('package', `${path} is missing: the plugin's version comes from it`);
    throw error;
  });
  const { version } = JSON.parse(text) as { readonly version?: unknown };
  if (typeof version !== 'string' || version === '') throw new BuildFailed('package', `${path} names no version`);
  return version;
};

const typeCheck = (directory: string): void => {
  const path = join(directory, 'tsconfig.json');
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error !== undefined) throw new BuildFailed('types', ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, directory, undefined, path);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length > 0)
    throw new BuildFailed(
      'types',
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n',
      }),
    );
};

const definitionOf = async (directory: string): Promise<PluginDefinition> => {
  const module = (await import(join(directory, DEFINITION))) as { readonly default?: unknown };
  const definition = module.default;
  if (typeof definition !== 'object' || definition === null || !('id' in definition) || !('title' in definition))
    throw new BuildFailed(
      'definition',
      `${DEFINITION} exports no plugin as its default: write export default definePlugin({ id, title, … })`,
    );
  return definition as PluginDefinition;
};

const entryPlugin = (directory: string): BunPlugin => ({
  name: 'tagma-plugin',
  setup: (build) => {
    build.onResolve({ filter: /^tagma-plugin:process$/u }, () => ({ path: ENTRY, namespace: NAMESPACE }));
    build.onLoad({ filter: /.*/u, namespace: NAMESPACE }, () => ({
      loader: 'ts',
      resolveDir: directory,
      contents: [
        `import { servePlugin } from ${JSON.stringify(fileURLToPath(import.meta.resolve('@runlith/tagma/plugin/process')))};`,
        `import plugin from ${JSON.stringify(join(directory, DEFINITION))};`,
        'await servePlugin(plugin);',
        '',
      ].join('\n'),
    }));
    build.onLoad({ filter: /\.node$/u }, ({ path }) => {
      throw new BuildFailed('bundle', `${path} is a native addon, which a plugin's process cannot carry`);
    });
  },
});

const bundled = async (directory: string): Promise<{ readonly code: string; readonly read: readonly string[] }> => {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    plugins: [entryPlugin(directory)],
    target: 'bun',
    format: 'esm',
    minify: true,
    sourcemap: 'external',
    throw: false,
  });
  if (!result.success) throw new BuildFailed('bundle', result.logs.map((log) => String(log)).join('\n'));
  const code = result.outputs.find((output) => output.kind === 'entry-point');
  const map = result.outputs.find((output) => output.kind === 'sourcemap');
  if (code === undefined || map === undefined) throw new BuildFailed('bundle', 'the bundler answered no process module');
  const text = await code.text();
  const computed = computedImports(text);
  if (computed > 0)
    throw new BuildFailed(
      'bundle',
      `the process names a module by a computed value in ${computed} import or require ${computed === 1 ? 'call' : 'calls'}, which its runtime cannot install: import each module by its literal name`,
    );
  const { sources } = JSON.parse(await map.text()) as { readonly sources: readonly string[] };
  const real = sources.filter((source) => !source.startsWith(`${NAMESPACE}:`));
  const base = await realpath(process.cwd());
  return { code: text, read: real.map((source) => resolve(base, source)) };
};

const sourcesOf = (directory: string, read: readonly string[]): readonly string[] => {
  const inside = read.flatMap((file) => {
    const path = relative(directory, file).replaceAll('\\', '/');
    return path === '' || path.startsWith('../') || path.split('/').includes('node_modules') ? [] : [path];
  });
  return [...new Set([...inside, 'package.json'])].sort();
};

const sourceHash = async (directory: string, sources: readonly string[]): Promise<string> => {
  const hash = createHash('sha256');
  for (const path of sources) {
    const bytes = await readFile(join(directory, path));
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
};

export const buildPlugin = async (folder: string): Promise<Built> => {
  const directory = await realpath(resolve(folder));
  const version = await versionOf(directory);
  typeCheck(directory);
  const definition = await definitionOf(directory);
  const described = (() => {
    try {
      return describePlugin(definition);
    } catch (error) {
      if (error instanceof PluginInvalid) throw new BuildFailed('definition', error.message);
      throw error;
    }
  })();
  const { code, read } = await bundled(directory);
  const sources = sourcesOf(directory, read);
  const { id, title, description, process, options, contributes } = manifestOf(described);
  const build = { hash: await sourceHash(directory, sources), sources };
  const text = `${JSON.stringify({ id, title, version, description, process, options, build, contributes }, null, 2)}\n`;
  const manifest = JSON.parse(text) as PluginEnvelope;
  const refused = manifestRefusal(manifest);
  if (refused !== null) throw new BuildFailed('check', `${MANIFEST}: ${refused}`);
  const entry = join(directory, PROCESS_ENTRY);
  if (described.process === null) await rm(entry, { force: true });
  else {
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, code);
  }
  await writeFile(join(directory, MANIFEST), text);
  return { manifest, process: described.process !== null };
};

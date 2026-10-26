import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, matchesGlob, posix } from 'node:path';
import { Schema } from 'effect';
import { scriptsOf } from '@runlith/code-facts/adapters';
import type { ImportSite } from '@runlith/code-facts/imports';
import { configResolver } from '@runlith/code-facts/js/config';
import { failureOf, importSites, parsedNow } from '@runlith/code-facts/js/imports';
import { resolveUnique } from '@runlith/code-facts/js/resolve';
import { workspaceMembers } from '@runlith/code-facts/js/workspace';
import { RUNTIMES as RUNNING } from '@runlith/code-facts/runtimes';
import { PlatformJob, type PlatformAnswer } from './platformsWire.js';

declare const self: Worker;

type Raw = Record<string, unknown>;
type Check = { readonly builtin: string; readonly params: Raw };
type Config = { readonly output: string; readonly source: string; readonly why: string };
type Alias = readonly [key: string, target: string];
type Kit = { readonly routes: string; readonly hooks: string; readonly aliases: readonly Alias[] };
type Node = { readonly type: string; readonly [key: string]: unknown };
type Disk = { readonly listed: readonly string[]; readonly has: (path: string) => boolean; readonly read: (path: string) => string };

const RUNTIMES = ['node', 'bun'];
const PLATFORMS = {
  browser: { runtime: 'browser', conditions: ['svelte', 'module', 'production'] },
  ssr: { runtime: 'node', conditions: ['svelte', 'module', 'production'] },
  node: { runtime: 'node', unmarked: true },
  bun: { runtime: 'bun', unmarked: true },
};
const RENDERING = { client: 'browser', server: 'ssr' };
const WORKERS = ['?worker', '?sharedworker'];
const SOURCE = /\.(?:[cm]?[jt]sx?|svelte)$/u;
const QUERY = /^\?[^\s?#/]+$/u;
const VIRTUAL = ['$app', '$env', '$service-worker'];
const PAGES = ['+page.svelte', '+page.ts', '+page.js', '+error.svelte', '+error.ts', '+error.js'];
const LAYOUTS = ['+layout.svelte', '+layout.ts', '+layout.js'];
const OPTION = { export: 'ssr', off: [false], pages: ['+page.ts', '+page.js'], layouts: ['+layout.ts', '+layout.js'] };
const SERVED = ['+server', '+page.server', '+layout.server'];
const WRAPPERS = ['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'];
const GLOB = /[*?[\]{}()!]/u;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9~-][\w.~-]*\/)?[A-Za-z0-9~-][\w.~-]*$/u;

class Unsupported {
  constructor(readonly reason: string) {}
}

const fail = (reason: string): never => {
  throw new Unsupported(reason);
};

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((one) => typeof one === 'string');
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const inside = (path: string, root: string): boolean => root === '' || path === root || path.startsWith(`${root}/`);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const node = (value: unknown): Node | undefined =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' ? (value as Node) : undefined;

const parsed = (path: string, text: string, lang: 'js' | 'ts') =>
  parsedNow(path, { text, at: 0, tries: [{ lang, sourceType: 'module' }], module: true });

const propertiesOf = (value: unknown): readonly Node[] => {
  const expression = node(value);
  if (expression?.type !== 'ObjectExpression') return fail('SvelteKit configuration must use a static object');
  if (!Array.isArray(expression.properties)) return fail('SvelteKit configuration has an unsupported property list');
  return expression.properties.map((property: unknown) => node(property) ?? fail('SvelteKit configuration has an unsupported property'));
};

const keyOf = (property: Node): string => {
  if (property.type !== 'Property' || property.computed === true || property.kind !== 'init')
    fail('SvelteKit configuration has a computed or spread property');
  const key = node(property.key);
  if (key?.type === 'Identifier' && typeof key.name === 'string') return key.name;
  if (key?.type === 'Literal' && typeof key.value === 'string') return key.value;
  return fail('SvelteKit configuration has a non-string key');
};

const fieldOf = (value: unknown, key: string): unknown => {
  let found: unknown;
  for (const property of propertiesOf(value)) if (keyOf(property) === key) found = property.value;
  return found;
};

const textOf = (value: unknown): string => {
  const literal = node(value);
  return literal?.type === 'Literal' && typeof literal.value === 'string'
    ? literal.value
    : fail('SvelteKit paths and aliases must be static strings');
};

const placed = (at: string, value: string): string => {
  if (value.startsWith('/') || value.includes('\\')) fail('SvelteKit paths outside the repository are not inspectable');
  return posix.join(at, value);
};

function kitOf(source: string, config: string, at: string): Kit {
  const defaults = { routes: posix.join(at, 'src/routes'), hooks: posix.join(at, 'src/hooks.server'), aliases: [] };
  const program = parsed(config, source, 'js');
  if (failureOf(program) !== undefined) fail('SvelteKit configuration could not be parsed');
  const variables = new Map<string, unknown>();
  let exported: unknown;
  for (const statement of program.program.body as unknown as readonly Node[]) {
    if (statement.type === 'VariableDeclaration' && Array.isArray(statement.declarations)) {
      for (const declaration of statement.declarations) {
        const binding = node(declaration);
        const id = node(binding?.id);
        if (id?.type === 'Identifier' && typeof id.name === 'string') variables.set(id.name, binding?.init);
      }
    }
    if (statement.type === 'ExportDefaultDeclaration') exported = statement.declaration;
  }
  const identity = node(exported);
  if (identity?.type === 'Identifier') exported = variables.get(identity.name as string);
  if (exported === undefined) fail('SvelteKit configuration has no static default export');
  const kit = fieldOf(exported, 'kit');
  if (kit === undefined) return defaults;
  const alias = fieldOf(kit, 'alias');
  const aliases = alias === undefined ? [] : propertiesOf(alias).map((property): Alias => [keyOf(property), textOf(property.value)]);
  const files = fieldOf(kit, 'files');
  const routes = files === undefined ? undefined : fieldOf(files, 'routes');
  const hooks = files === undefined ? undefined : fieldOf(files, 'hooks');
  const server = hooks === undefined ? undefined : fieldOf(hooks, 'server');
  return {
    routes: routes === undefined ? defaults.routes : placed(at, textOf(routes)),
    hooks: server === undefined ? defaults.hooks : placed(at, textOf(server)),
    aliases,
  };
}

const aliasedOld = (specifier: string, at: string, aliases: readonly Alias[]): string | undefined => {
  const entries = [...aliases, ['$lib', 'src/lib'] as const].sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of entries) {
    const star = key.endsWith('/*');
    const prefix = star ? key.slice(0, -1) : key;
    if (star ? !specifier.startsWith(prefix) : specifier !== prefix && !specifier.startsWith(`${prefix}/`)) continue;
    const fill = specifier.slice(prefix.length);
    return placed(at, star ? value.replaceAll('*', fill) : `${value}${fill}`);
  }
  return undefined;
};

type Scope = {
  readonly at: string;
  readonly aliases: readonly Alias[] | undefined;
  readonly internal: readonly string[];
  readonly generated: readonly string[];
};

const packageOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

const internalTo = (prefixes: readonly string[], request: string): boolean =>
  prefixes.some((prefix) => request === prefix || request.startsWith(`${prefix}/`) || (prefix.endsWith(':') && request.startsWith(prefix)));

const OLD_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.tsx', '.jsx', '.svelte', '.json', '.cjs', '.cts'];

const oldLanding = (target: string, has: (path: string) => boolean, svelte: boolean): string | undefined => {
  const candidates = [
    ...new Set([
      target,
      target.replace(/\.[cm]?js$/u, '.ts'),
      ...OLD_EXTENSIONS.map((extension) => `${target}${extension}`),
      ...OLD_EXTENSIONS.map((extension) => posix.join(target, `index${extension}`)),
    ]),
  ];
  if (svelte && has(candidates[0]!)) return candidates[0];
  const found = candidates.filter(has);
  return found.length === 1 ? found[0] : undefined;
};

const newLanding = (specifier: string, from: string, disk: Disk): string | undefined => {
  const read = resolveUnique(specifier, from, disk);
  return 'to' in read ? read.to : undefined;
};

const aimedAt = (specifier: string, from: string): string => posix.join(posix.dirname(from), specifier).replace(/(.)\/+$/u, '$1');

function importsHeld(
  disk: Disk,
  base: string,
  leaves: readonly string[],
  scopes: readonly Scope[],
  internal: readonly string[],
  configs: readonly Config[],
): readonly string[] {
  const listing = { ...disk, paths: () => disk.listed };
  let members: ReadonlyMap<string, { readonly dir: string }>;
  try {
    members = workspaceMembers(listing, base)?.packages ?? new Map();
  } catch (error) {
    return fail(`the workspace under ${base || 'the repository root'} could not be read: ${messageOf(error)}`);
  }
  const dirs = [...members.values()].map(({ dir }) => dir);
  const resolve = configResolver(disk, (name) => members.get(name)?.dir, new Map(configs.map(({ output, source }) => [output, source])));
  const workers = new Set(WORKERS);
  for (const file of disk.listed) {
    if (!SOURCE.test(file) || !inside(file, base)) continue;
    const scope = scopes.find((one) => inside(file, one.at));
    if (scope === undefined && !dirs.some((dir) => inside(file, dir))) continue;
    const generated = (path: string): boolean =>
      scopes.some((one) => inside(path, one.at) && one.generated.some((glob) => matchesGlob(path.slice(one.at.length + 1), glob)));
    let sites: readonly ImportSite[];
    try {
      sites = importSites(readOf(disk, file), file, scriptsOf);
    } catch (error) {
      if (error instanceof Unsupported) throw error;
      continue;
    }
    const at = (site: ImportSite, what: string): never => fail(`${file}:${site.line} imports \`${site.specifier}\`: ${what}`);
    const landing = (site: ImportSite, request: string) => {
      try {
        return resolve(request, file, disk, new Set());
      } catch (error) {
        return at(site, `the tsconfig over it could not be read: ${messageOf(error)}`);
      }
    };
    for (const site of sites) {
      if (site.loads === 'never' || (site.kind !== undefined && site.kind !== 'worker')) continue;
      const { specifier } = site;
      const queried = site.kind !== 'worker' && /\?(?:sharedworker|worker)(?:&|$)/u.test(specifier);
      if (queried) {
        const query = specifier.slice(specifier.indexOf('?'));
        if (!QUERY.test(query)) at(site, `its worker query ${query} cannot be declared`);
        workers.add(query);
      }
      if (site.kind !== 'worker' && !queried && leaves.some((suffix) => specifier.endsWith(suffix))) continue;
      const request = site.kind === 'worker' || queried ? specifier.split('?')[0]! : specifier;
      if (request.startsWith('/')) continue;
      if (request.startsWith('.')) {
        if (generated(posix.join(posix.dirname(file), request))) continue;
        const old = oldLanding(aimedAt(request, file), disk.has, request.endsWith('.svelte'));
        const now = newLanding(request, file, disk);
        if (old !== now)
          at(site, `the old reading landed it on ${old ?? 'no single file'} and the current one on ${now ?? 'no single file'}`);
        continue;
      }
      const old = scope?.aliases === undefined ? undefined : aliasedOld(request, scope.at, scope.aliases);
      const answer = landing(site, request);
      if (old !== undefined) {
        const target = old.replace(/(.)\/+$/u, '$1');
        const was = generated(old) ? 'a generated file' : (oldLanding(target, disk.has, target.endsWith('.svelte')) ?? 'no single file');
        const is =
          answer === null
            ? 'no alias'
            : generated('to' in answer ? answer.to : answer.unlisted)
              ? 'a generated file'
              : 'to' in answer
                ? answer.to
                : !internalTo([...internal, ...scope!.internal], request) && !PACKAGE_NAME.test(packageOf(request))
                  ? 'no single file'
                  : 'no file, read on as a package';
        if (was !== is) at(site, `SvelteKit's alias landed it on ${was} and the tsconfig on ${is}`);
        continue;
      }
      if (answer !== null && 'to' in answer) at(site, `the tsconfig lands it on ${answer.to}, where the old reading took it for a package`);
      if (answer !== null && 'unlisted' in answer && generated(answer.unlisted))
        at(site, `the tsconfig aims it at the generated ${answer.unlisted}`);
      if (internalTo([...internal, ...(scope?.internal ?? [])], request)) continue;
      if (RUNNING.some((runtime) => runtime.builtin(request) !== undefined)) continue;
      if (request.startsWith('#') || request.includes(':')) continue;
      if (request.includes('?') || !PACKAGE_NAME.test(packageOf(request)))
        at(site, 'it names no package or declared prefix, where the old reading took it for a package');
    }
  }
  return [...workers];
}

function optionsHeld(disk: Disk, routes: string): void {
  const names = [...OPTION.pages, ...OPTION.layouts];
  for (const path of disk.listed) {
    if (!inside(path, routes) || !names.includes(posix.basename(path))) continue;
    const program = parsed(path, readOf(disk, path), path.endsWith('.ts') ? 'ts' : 'js');
    if (failureOf(program) !== undefined) continue;
    for (const statement of program.program.body as unknown as readonly Node[]) {
      if (statement.type !== 'ExportNamedDeclaration') continue;
      const declaration = node(statement.declaration);
      const binding =
        declaration?.type === 'VariableDeclaration' && Array.isArray(declaration.declarations)
          ? declaration.declarations.map(node).find((one) => node(one?.id)?.name === OPTION.export)
          : undefined;
      if (binding !== undefined) {
        let init = node(binding.init);
        while (init !== undefined && WRAPPERS.includes(init.type)) init = node(init.expression);
        if (init?.type === 'Literal' && init.value === false && node(binding.init)?.type !== 'Literal')
          fail(`${path} turns \`ssr\` off through a wrapped literal, which SvelteKit's old reading left on`);
        break;
      }
      const listed = (Array.isArray(statement.specifiers) ? statement.specifiers : []).some((specifier: unknown) => {
        const exported = node(node(specifier)?.exported);
        return (exported?.type === 'Literal' ? exported.value : exported?.name) === OPTION.export;
      });
      if (statement.source == null && listed) fail(`${path} exports \`ssr\` from an export list, which SvelteKit's old reading skipped`);
    }
  }
}

const readOf = (disk: Disk, path: string): string => {
  try {
    return disk.read(path);
  } catch (error) {
    return fail(`${path} could not be read: ${messageOf(error)}`);
  }
};

const within = (at: string, path: string): string | undefined => {
  const relative = posix.relative(at, path);
  return relative.startsWith('..') ? undefined : relative;
};

const literalPath = (path: string): string => (GLOB.test(path) ? fail(`${path} holds a glob character`) : path);

const ssrKept = (glob: string, routes: string): boolean => {
  const fixed: string[] = [];
  for (const segment of glob.split('/')) {
    if (GLOB.test(segment)) {
      const prefix = fixed.join('/');
      if (inside(prefix, routes)) return false;
      if (inside(routes, prefix))
        fail(`the ssr glob ${glob} reaches into the routes directory ${routes}, where it started only routed files`);
      return true;
    }
    fixed.push(segment);
  }
  return !inside(glob, routes);
};

type App = Raw & {
  readonly at: string;
  readonly internal: readonly string[];
  readonly ssr?: readonly string[];
  readonly files: { readonly extensions: readonly string[] };
};

const isApp = (value: unknown): value is App =>
  isRecord(value) &&
  typeof value.at === 'string' &&
  isStrings(value.internal) &&
  (value.ssr === undefined || isStrings(value.ssr)) &&
  isRecord(value.files) &&
  isStrings(value.files.extensions);

type Read = { readonly app: Raw & { readonly internal: readonly string[] }; readonly kit: boolean; readonly scope: Scope };

function appOf(app: App, base: string, disk: Disk): Read {
  const at = posix.join(base, app.at);
  const config = posix.join(at, 'svelte.config.js');
  const kit = disk.has(config) ? kitOf(readOf(disk, config), config, at) : undefined;
  const aliasing = kit !== undefined || app.internal.includes('$lib');
  const aliases = aliasing ? (kit?.aliases ?? []) : undefined;
  const keys = aliases === undefined ? [] : ['$lib', ...aliases.map(([key]) => key)];
  const { ssr, internal, ...kept } = app;
  const next = {
    ...kept,
    internal: internal.filter((prefix) => !keys.some((key) => prefix === key || `${prefix}/*` === key)),
  } as Read['app'] & Raw;
  const scope = { at, aliases, internal: next.internal, generated: isStrings(app.generated) ? app.generated : [] };
  if (kit === undefined) {
    if (ssr !== undefined) next.ssr = ssr;
    return { app: next, kit: false, scope };
  }
  const routes = within(at, kit.routes);
  if (routes === '') fail(`the routes directory ${kit.routes} is the app itself`);
  const hooks = within(at, kit.hooks);
  const server = [
    ...(hooks === undefined || hooks === '' ? [] : [literalPath(hooks), `${hooks}.{ts,js}`]),
    ...(routes === undefined ? [] : SERVED.map((name) => `${literalPath(routes)}/**/${name}.{ts,js}`)),
  ];
  const started = ssr === undefined ? undefined : routes === undefined ? ssr : ssr.filter((glob) => ssrKept(glob, routes));
  if (started !== undefined && started.length > 0) next.ssr = started;
  if (server.length > 0) next.server = server;
  if (routes !== undefined && disk.listed.some((path) => inside(path, kit.routes) && PAGES.includes(posix.basename(path)))) {
    optionsHeld(disk, kit.routes);
    next.routes = { at: routes, pages: PAGES, layouts: LAYOUTS, option: OPTION };
  }
  return { app: next, kit: true, scope };
}

function diskOf(root: string): Disk {
  let listed: string;
  try {
    listed = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (error) {
    return fail(`the project tree at ${root} could not be listed: ${messageOf(error)}`);
  }
  const paths = listed.split('\0').filter((path) => path !== '' && existsSync(join(root, path)));
  const held = new Set(paths);
  return { listed: paths, has: (path) => held.has(path), read: (path) => readFileSync(join(root, path), 'utf8') };
}

const unmigrated = (params: Raw, reason: string): Raw => ({ ...params, unmigrated: reason });

function platformsOf(params: Raw, readDisk: () => Disk, configs: readonly Config[]): Raw {
  const { built, apps, ...rest } = params;
  const { base, leaves, files } = params;
  if (
    typeof base !== 'string' ||
    !isStrings(built) ||
    !isStrings(leaves) ||
    !isRecord(files) ||
    !isStrings(files.extensions) ||
    !Array.isArray(apps) ||
    !apps.every(isApp)
  )
    return unmigrated(params, 'the stored parameters are not the form this step migrates');
  const copies = configs.flatMap((config) => {
    const output = within(base, config.output);
    const source = within(base, config.source);
    return output === undefined || output === '' || source === undefined || source === '' ? [] : [{ ...config, output, source }];
  });
  let read: readonly Read[];
  let workers: readonly string[];
  let internal: readonly string[];
  try {
    const disk = readDisk();
    read = apps.map((app) => appOf(app, base, disk));
    internal = read.some((one) => one.kit) ? VIRTUAL : [];
    read = read.map((one) => {
      const own = one.app.internal.filter((prefix) => !internal.includes(prefix));
      return { ...one, app: { ...one.app, internal: own }, scope: { ...one.scope, internal: own } };
    });
    workers = importsHeld(
      disk,
      base,
      leaves,
      read.map((one) => one.scope),
      internal,
      configs,
    );
  } catch (error) {
    if (error instanceof Unsupported) return unmigrated(params, error.reason);
    throw error;
  }
  return {
    ...rest,
    platforms: PLATFORMS,
    shipped: 'bun',
    rendering: RENDERING,
    apps: read.map(({ app }) => app),
    compiled: built,
    ...(copies.length === 0 ? {} : { built: copies }),
    ...(internal.length === 0 ? {} : { internal }),
    workers,
  };
}

const checksOf = (fields: Raw): readonly Check[] | undefined => {
  const enforcement = fields.enforcement;
  if (!isRecord(enforcement) || !Array.isArray(enforcement.checks)) return undefined;
  return enforcement.checks as readonly Check[];
};

const builtinOf = (check: unknown, builtin: string): check is Check =>
  isRecord(check) && check.builtin === builtin && isRecord(check.params);

const configsOf = (checks: readonly Check[]): readonly Config[] => {
  const found = new Map<string, Config>();
  for (const check of checks) {
    if (!builtinOf(check, 'modules') || !Array.isArray(check.params.built)) continue;
    const base = typeof check.params.base === 'string' ? check.params.base : '';
    for (const entry of check.params.built as readonly unknown[]) {
      if (!isRecord(entry) || typeof entry.output !== 'string' || typeof entry.source !== 'string' || typeof entry.why !== 'string')
        continue;
      if (!entry.output.endsWith('.json')) continue;
      const output = posix.join(base, entry.output);
      found.set(output, { output, source: posix.join(base, entry.source), why: entry.why });
    }
  }
  return [...found.values()];
};

function migrated(check: Check, readDisk: () => Disk, configs: readonly Config[]): Check {
  if ((builtinOf(check, 'modules') || builtinOf(check, 'loads')) && !Object.hasOwn(check.params, 'runtimes'))
    return { ...check, params: { ...check.params, runtimes: RUNTIMES } };
  if (builtinOf(check, 'platforms') && !Object.hasOwn(check.params, 'platforms') && !Object.hasOwn(check.params, 'unmigrated'))
    return { ...check, params: platformsOf(check.params, readDisk, configs) };
  return check;
}

function changed(job: PlatformJob): PlatformAnswer {
  const enforced = job.rows.flatMap((row) => {
    const checks = checksOf(row.fields);
    return checks === undefined ? [] : [{ row, checks }];
  });
  const configs = configsOf(enforced.flatMap(({ checks }) => checks));
  let disk: Disk | undefined;
  const readDisk = () => (disk ??= diskOf(job.root));
  const rows = enforced.flatMap(({ row, checks }) => {
    const next = checks.map((check) => migrated(check, readDisk, configs));
    return same(next, checks)
      ? []
      : [{ id: row.id, fields: { ...row.fields, enforcement: { ...(row.fields.enforcement as Raw), checks: next } } }];
  });
  return { state: 'changed', rows };
}

self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    self.postMessage(changed(Schema.decodeUnknownSync(PlatformJob)(event.data)));
  } catch (error) {
    self.postMessage({ state: 'failed', message: messageOf(error) } satisfies PlatformAnswer);
  }
};
self.postMessage({ state: 'ready' });

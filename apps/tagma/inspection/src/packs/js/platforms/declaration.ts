import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { base, built, entry, filesOf, query, runtime } from '../../../core/params';
import type { Shown } from '../../../core/rule';
import type { Runtime } from '@runlith/code-facts/runtime';
import { RUNTIMES } from '@runlith/code-facts/runtimes';

export type Platform = string;
export type Form = 'import' | 'require';
export type Declared = {
  readonly [name: string]: { readonly runtime: string; readonly conditions?: readonly string[]; readonly unmarked?: boolean };
};
export type Conditions = (platform: Platform, form: Form) => ReadonlySet<string>;

const RUNNING: ReadonlyMap<string, Runtime> = new Map(RUNTIMES.map((runtime) => [runtime.id, runtime]));

const runtimeOf = (declared: Declared, platform: Platform): Runtime => RUNNING.get(declared[platform]!.runtime)!;

export type Running = { readonly declared: Declared; readonly shipped: Platform; readonly conditions: Conditions };

const formed = new WeakMap<Declared, Conditions>();

const conditionsFor = (declared: Declared): Conditions => {
  const held = formed.get(declared);
  if (held !== undefined) return held;
  const sets = new Map(
    Object.keys(declared).flatMap((platform) =>
      (['import', 'require'] as const).map((form) => [
        `${platform}\0${form}`,
        new Set([...runtimeOf(declared, platform).conditions, ...(declared[platform]!.conditions ?? []), form]),
      ]),
    ),
  );
  const conditions: Conditions = (platform, form) => sets.get(`${platform}\0${form}`)!;
  formed.set(declared, conditions);
  return conditions;
};

export const runningOf = (params: { readonly platforms: Declared; readonly shipped: Platform }): Running => ({
  declared: params.platforms,
  shipped: params.shipped,
  conditions: conditionsFor(params.platforms),
});

const runs = (declared: Declared, platform: Platform, runtime: string): boolean => {
  const own = runtimeOf(declared, platform);
  return own.id === runtime || own.provides.includes(runtime);
};

export const admits = (declared: Declared, platform: Platform, marked: readonly Platform[]): boolean =>
  marked.includes(platform) ||
  marked.some((one) => RUNNING.has(one) && runs(declared, platform, one)) ||
  (marked.length === 0 && declared[platform]!.unmarked === true);

export const builtinOn = (
  declared: Declared,
  platform: Platform,
  specifier: string,
): { readonly name: string; readonly refused: boolean } | undefined => {
  for (const runtime of RUNTIMES) {
    const name = runtime.builtin(specifier);
    if (name !== undefined) return { name, refused: !runs(declared, platform, runtime.id) };
  }
  return undefined;
};

const languages: Languages = ['js'];
const files = filesOf(extensionsOf(languages));
const specifier = Schema.NonEmptyString.check(Schema.isPattern(/^(?:@[\w.-]+|[\w:.-]+)(?:\/[\w.*-]+)*$/u));
const entries = Schema.Array(specifier);
const packageName = Schema.NonEmptyString.check(Schema.isPattern(/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u)).annotate({
  description: 'A workspace package name, with its `@scope/` where it has one.',
});
const platformName = Schema.NonEmptyString.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*$/u),
  Schema.makeFilter((name) => (name === 'any' ? '`any` names every platform in `loads`, never one platform' : undefined)),
).annotate({ description: 'A platform the rule declares in `platforms`.' });
const platformLists = Schema.Record(platformName, entries);
const loads = Schema.Record(Schema.String, entries).annotate({
  description: 'What the package may not load, by declared platform, or under `any` on every platform.',
});
const packageRule = Schema.Struct({ names: Schema.optional(entries), loads: Schema.optional(loads) });
const conditions = Schema.Array(
  Schema.NonEmptyString.check(
    Schema.isPattern(/^[^\s.][^\s]*$/u),
    Schema.makeFilter((name) =>
      ['import', 'require', 'default'].includes(name)
        ? 'the import form and `default` are read on every platform, never declared'
        : undefined,
    ),
  ),
);
const platform = Schema.Struct({
  runtime,
  conditions: Schema.optional(conditions).annotate({
    description:
      "Export conditions a workspace package's `exports` map is read under on this platform, besides the import form, `default` and the runtime's own.",
  }),
  unmarked: Schema.optional(Schema.Boolean).annotate({
    description: 'Whether a package door that names no platform runs here.',
  }),
});
const glob = Schema.NonEmptyString.annotate({ description: 'A glob matched against the path relative to the app.' });
const fileName = Schema.NonEmptyString.check(Schema.isPattern(/^[^/\\\s]+$/u)).annotate({
  description: 'A file name, without its directory.',
});
const optionFile = fileName.check(Schema.isPattern(/\.(?:[cm]?[jt]s|[jt]sx)$/u)).annotate({
  description: 'A script file name, without its directory: `.js`, `.jsx`, `.ts`, `.tsx` and their `.m`/`.c` forms.',
});
const routes = Schema.Struct({
  at: entry.annotate({ description: 'The routed directory, relative to the app.' }),
  pages: Schema.Array(fileName).annotate({
    description:
      'Names of the files that render a route: each starts on the server platform where server rendering is on in its directory.',
  }),
  layouts: Schema.Array(fileName).annotate({
    description:
      'Names of the files that wrap the routes below: each starts on the server platform where a page at or below its directory does.',
  }),
  option: Schema.optional(
    Schema.Struct({
      export: Schema.NonEmptyString.check(Schema.isPattern(/^[A-Za-z_$][\w$]*$/u)),
      off: Schema.NonEmptyArray(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])),
      pages: Schema.Array(optionFile),
      layouts: Schema.Array(optionFile),
    }),
  ).annotate({
    description:
      'The export that turns server rendering off: a literal named in `off` exported under that name — directly or through `export { … }` — from a file named in `pages` turns it off for its directory, from one named in `layouts` for its directory and every one below, the nearer file deciding; any other value, a value that is not a literal, or a file that does not parse turns it on.',
  }),
});
const app = Schema.Struct({
  at: base,
  roots: Schema.NonEmptyArray(entry),
  ssr: Schema.optional(Schema.Array(glob)).annotate({
    description: 'Files that start on the server platform as well, whatever `routes.option` decides for their directory.',
  }),
  server: Schema.optional(Schema.Array(glob)).annotate({
    description:
      'Files that start on the server platform alone: never a client start, under a root or not. A file the client walk reaches by import is still entered.',
  }),
  routes: Schema.optional(routes),
  internal: Schema.Array(Schema.NonEmptyString).annotate({
    description:
      'Specifier prefixes the app’s toolchain provides with no file in the tree; an import under one is neither walked nor judged.',
  }),
  generated: Schema.optional(Schema.Array(entry)),
  injected: Schema.optional(Schema.Array(entry)),
  files,
});
const leaves = Schema.Array(Schema.Union([Schema.String.check(Schema.isPattern(/^\.[a-z0-9]+$/u)), query])).annotate({
  description:
    'Extensions of data files and queries a bundler reads as data: an import ending in one, or landing on a file ending in one, loads no code and is not walked.',
});
const workers = Schema.Array(query).annotate({
  description:
    'Queries a bundler reads as a worker: an import ending in one starts the file it names, without the query, as a worker of its own.',
});
const params = Schema.Struct({
  base,
  platforms: Schema.Record(platformName, platform).annotate({
    description: 'The platforms a start runs on, each named by the rule and run by a runtime adapter.',
  }),
  shipped: platformName.annotate({
    description: "The platform a package's `main`, `bin` and doors that name no platform start on.",
  }),
  rendering: Schema.optional(Schema.Struct({ client: platformName, server: platformName })).annotate({
    description: "The platforms an app's `roots` start on (`client`) and its `ssr`, `server` and routed files start on (`server`).",
  }),
  allows: platformLists.annotate({
    description: 'What a platform may load although its runtime refuses it as another runtime’s built-in.',
  }),
  refuses: platformLists,
  packages: Schema.Record(Schema.String, packageRule),
  apps: Schema.Array(app),
  programs: Schema.optional(Schema.Array(Schema.Struct({ at: entry, platform: platformName, replaces: Schema.optional(entry) }))),
  compiled: Schema.Array(packageName).annotate({
    description: 'Workspace packages whose doors name compiled output the tree does not hold.',
  }),
  built: Schema.optional(
    built.annotate({
      description:
        'Exact built output files, relative to base, each with the tracked source that stands for it and the reason: a tsconfig extending an output the tree lacks reads the source in its place, so its `paths` and `baseUrl` aliases resolve bare imports.',
    }),
  ),
  loaders: Schema.optional(Schema.Array(Schema.Struct({ at: entry, why: Schema.NonEmptyString }))),
  internal: Schema.optional(Schema.Array(Schema.NonEmptyString)).annotate({
    description:
      'Specifier prefixes the toolchain provides with no file in the tree, in every file under base; an app adds its own `internal`. An import under one is neither walked nor judged.',
  }),
  leaves,
  workers: Schema.optional(workers),
  files,
}).check(
  Schema.makeFilter((value) => {
    const named = (name: string): boolean => Object.hasOwn(value.platforms, name);
    const used = [
      value.shipped,
      ...(value.rendering === undefined ? [] : [value.rendering.client, value.rendering.server]),
      ...Object.keys(value.allows),
      ...Object.keys(value.refuses),
      ...Object.values(value.packages).flatMap((rule) => Object.keys(rule.loads ?? {}).filter((key) => key !== 'any')),
      ...(value.programs ?? []).map((program) => program.platform),
    ];
    const unknown = used.find((name) => !named(name));
    return unknown === undefined ? undefined : `\`${unknown}\` names no platform the rule declares`;
  }),
  Schema.makeFilter((value) =>
    value.apps.length > 0 && value.rendering === undefined ? 'apps need `rendering` to name the platforms they start on' : undefined,
  ),
  Schema.makeFilter((value) =>
    value.apps.some((one, at) => value.apps.some((other, next) => at !== next && under(one.at, other.at)))
      ? 'an app may not contain another app'
      : undefined,
  ),
  Schema.makeFilter((value) => {
    const named = [...value.leaves, ...(value.workers ?? [])];
    return new Set(named).size === named.length ? undefined : 'a leaf or worker query is named once, in one list';
  }),
);

type Params = typeof params.Type;

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root.replace(/\/$/, '')}/`);

const shows = (value: Params): Shown => ({
  figures: [
    {
      kind: 'lists',
      lists: [
        ...Object.keys(value.platforms).flatMap((platform) => {
          const refused = value.refuses[platform] ?? [];
          return refused.length === 0 ? [] : [{ label: `Never loaded on ${platform}`, items: refused }];
        }),
        { label: 'Apps', items: value.apps.map(({ at }) => at) },
        { label: 'Programs', items: (value.programs ?? []).map(({ at, platform }) => `${at} (${platform})`) },
        { label: 'Packages with refusals of their own', items: Object.keys(value.packages) },
      ],
    },
  ],
});

export const platforms = {
  id: 'platforms',
  params,
  summary: 'Each start loads only what its platform runs and what its package does not refuse.',
  concern: 'loading',
  shows,
  describe: (value: Params): string =>
    `Platform closures under ${value.base || 'the repository root'}: ${value.apps.length} apps, shipped starts and ${Object.keys(value.packages).length} packages' refusals; direct names cover every selected package source (types included), runtime loads and undeclared dependencies cover shipped closure; unresolved reach is a violation.`,
  languages,
  reach: 'global',
  sliced: true,
  movedBy: 'fingerprint',
  unit: 'start',
  envelope: { files: 4_800, mib: 32 },
  relevant: () => true,
  follows: () => true,
  limitations: [
    ...RUNTIMES.flatMap((runtime) => (runtime.limitation === undefined ? [] : [runtime.limitation])),
    "A specifier one runtime adapter names a built-in is never walked, and on a platform whose runtime neither is nor provides that runtime it is refused under its built-in name unless the platform's `allows` names it.",
    'Third-party internals are outside the source tree. The build guard measures their browser residue separately.',
    'A package named in compiled is admitted by its manifest but its absent built door is not walked; its production sources are still starts for its names and loads.any rules. Its own relative import that resolves to no file is admitted under the top directory of a manifest target (`exports`, `main`, `bin`) the tree does not hold; a wildcard target names no such directory.',
    "Platforms, routes, server-only files and export conditions are what the rule declares; no framework's own configuration is read, so a declaration that falls behind it is judged as declared. A declared routes directory holding no page is a violation.",
    "A bare import is first resolved through the `paths` and `baseUrl` of the importer's nearest tsconfig, read as the `modules` inspection reads it, and one that lands on a file is walked there; one that lands on none and aims into a `node_modules` directory, a submodule the tree's `.gitmodules` declares or outside the checkout loads an installed package, which is not walked; a bare specifier whose first segment cannot name a package and that no alias lands is unresolved. A generated config is read through its `built` copy, and the config of an installed package or of a submodule the tree's `.gitmodules` declares from what the judging checkout holds there: both sides of a judgement read the same installed file, and a walk remembered through it is walked again once it changes, appears or goes away. A file whose `extends` chain names a config nothing installed provides is unresolved, naming that config: install the checkout's dependencies.",
    'The routes model is a directory tree of pages and of layouts wrapping the routes below, with one exported option deciding server rendering per directory. A per-file directive, a file kept out of a platform’s bundle by its name, and a second routed directory in one app are not expressible: declare such files through `ssr`, `server` and `roots`.',
    'A query is read only as the rule declares it: one in `leaves` ends the walk at that import, one in `workers` starts the file named without it as a worker; any other query stays part of the path, so the import is unresolved. A worker built from `new URL(…)` is followed with its query cut off.',
    'The source closure includes dynamic, worker and literal glob sites. Non-literal or ambiguous resolution, unreadable files and unsupported source outside declared leaves are violations, except a non-literal load inside a file an app declares injected: its function is serialized into a page, so its loads run there and belong to no start; and a non-literal load inside a file named in loaders, with its why: it loads code installed outside the tree at runtime, which no start of the tree reaches.',
    'The envelope bounds blobs read across both trees; the enforcement ask deadline is not implemented yet.',
  ],
  unblock: ['Cut the reported chain, correct the platform marker or dependency declaration, or provide a resolvable supported source.'],
} as const;

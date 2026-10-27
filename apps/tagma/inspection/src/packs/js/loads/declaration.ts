import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { baseOrRoot, built, defaulted, describeFiles, distinct, entry, filesOrAll, runtimes } from '../../../core/params';
import { moduleId, type ModuleMap, type Shown, territoryUnder } from '../../../core/rule';

const languages: Languages = ['js'];

const files = filesOrAll(extensionsOf(languages));

const specifier = Schema.String.check(Schema.isPattern(/^(?:@[^\s/@*]+\/[^\s/*]+|[^\s/.#@*][^\s/*]*)(?:\/[^\s/*]+)*(?:\/\*)?$/u)).annotate({
  description:
    'A specifier as an import spells it — a package, a subpath of one, or a built-in — never a relative or absolute path. It covers itself and every subpath under it; ending in `/*`, only the subpaths.',
});

type Entry = { readonly written: string; readonly under: string; readonly subpaths: boolean };

const entryOf = (written: string): Entry =>
  written.endsWith('/*') ? { written, under: written.slice(0, -2), subpaths: true } : { written, under: written, subpaths: false };

const narrows = (allowed: Entry, refused: Entry): boolean =>
  allowed.under.startsWith(`${refused.under}/`) || (allowed.under === refused.under && allowed.subpaths && !refused.subpaths);

export const narrowing = (allows: readonly string[], refused: string): readonly string[] =>
  allows.filter((allowed) => narrows(entryOf(allowed), entryOf(refused)));

export const refusalOf = (refuses: readonly string[], allows: readonly string[]): ((specifier: string) => string | undefined) => {
  const exact = new Map<string, Entry & { readonly refused: boolean }>();
  const below = new Map<string, Entry & { readonly refused: boolean }>();
  for (const entry of [
    ...refuses.map((written) => ({ ...entryOf(written), refused: true })),
    ...allows.map((written) => ({ ...entryOf(written), refused: false })),
  ]) {
    const held = entry.subpaths ? below : exact;
    if (!held.has(entry.under)) held.set(entry.under, entry);
  }
  return (specifier) => {
    let decided = exact.get(specifier);
    for (let at = specifier.lastIndexOf('/'); decided === undefined && at > 0; at = specifier.lastIndexOf('/', at - 1)) {
      const under = specifier.slice(0, at);
      decided = below.get(under) ?? exact.get(under);
    }
    return decided?.refused === true ? decided.written : undefined;
  };
};

const moduleRef = Schema.Struct({ module: moduleId }).annotate({
  description: 'A module of the module map, standing for its territory under `base`.',
});

const params = Schema.Struct({
  base: baseOrRoot,
  from: Schema.NonEmptyArray(Schema.Union([entry, moduleRef]))
    .check(
      Schema.makeFilter((entries) =>
        distinct(entries.map((one) => (typeof one === 'string' ? one : `{${one.module}}`))) ? undefined : 'an entry is named once',
      ),
    )
    .annotate({
      description:
        'The directories and files, relative to `base`, whose runtime loads are judged, and the modules whose territory under `base` is.',
    }),
  refuses: Schema.NonEmptyArray(specifier).annotate({
    description: 'What a selected file may not load at runtime, directly or through anything it loads.',
  }),
  allows: defaulted(
    Schema.Array(specifier).annotate({
      description:
        'What may be loaded although a refused entry covers it; an allowed workspace package is followed into. The narrowest entry of `refuses` and `allows` covering a specifier decides it: the one with the longer path, and at an equal path the one ending in `/*`.',
    }),
    [],
  ),
  reads: defaulted(
    Schema.Literals(['static', 'runtime']).annotate({
      description:
        'Which loads are followed: what loads with the module — value and side-effect imports, re-exports and `require` (`static`) — or those and every `import()` call (`runtime`). A type-only import is never followed.',
    }),
    'runtime',
  ),
  conditions: defaulted(
    Schema.Array(Schema.NonEmptyString).annotate({
      description: "The conditions a workspace package's `exports` map is read under, besides `default`, which always matches.",
    }),
    [],
  ),
  runtimes: Schema.optional(runtimes),
  built: Schema.optional(
    built.annotate({
      description:
        'Exact built output files, relative to base, each with the tracked source that stands for it and the reason: a tsconfig extending an output the tree lacks reads the source in its place, so its `paths` and `baseUrl` aliases resolve bare imports.',
    }),
  ),
  files,
}).check(
  Schema.makeFilter((value) => {
    const named = [...value.refuses, ...value.allows];
    if (new Set(named).size !== named.length) return 'a specifier is either refused or allowed, and named once';
    const idle = value.allows.find((allowed) => !value.refuses.some((refused) => narrows(entryOf(allowed), entryOf(refused))));
    return idle === undefined ? undefined : `${idle} is allowed, and it narrows no refused entry`;
  }),
);

type Params = typeof params.Type;

export type Run = Params & { readonly map: ModuleMap };

const expanded = new WeakMap<Run, readonly string[]>();

export const fromOf = (value: Run): readonly string[] => {
  const held = expanded.get(value);
  if (held !== undefined) return held;
  const entries = value.from.flatMap((one) =>
    typeof one === 'string' ? [one] : (territoryUnder(value.map, one.module, value.base) ?? []),
  );
  expanded.set(value, entries);
  return entries;
};

const mapProblem = (value: Params, map: ModuleMap): string | undefined => {
  const missing = value.from.find((one) => typeof one !== 'string' && territoryUnder(map, one.module, value.base) === undefined);
  return missing === undefined || typeof missing === 'string'
    ? undefined
    : `\`from\` names the module \`${missing.module}\`, which the module map does not hold`;
};

const said = (one: Params['from'][number]): string => (typeof one === 'string' ? one : `module ${one.module}`);

const READS = {
  static: 'what loads with the module',
  runtime: 'what loads with the module and every `import()` call',
} as const satisfies Record<Params['reads'], string>;

const listed = (entries: readonly string[]): string => entries.map((at) => `\`${at}\``).join(', ');

const describe = (value: Params): string => {
  const conditions = [...value.conditions, 'default'].map((at) => `\`${at}\``).join(', ');
  return [
    `Runtime loads ${describeFiles(value.base, value.files)}, from ${listed(value.from.map(said))}: following ${READS[value.reads]} through relative imports and workspace packages (\`exports\` read under ${conditions}), no selected file loads ${listed(value.refuses)}.`,
    ...(value.allows.length === 0 ? [] : [`Allowed: ${listed(value.allows)}.`]),
  ].join('\n');
};

const shows = (value: Run): Shown => ({
  figures: [
    {
      kind: 'lists',
      lists: [
        { label: 'Judged files', items: value.from.map(said) },
        { label: 'Never loaded', items: value.refuses },
        ...(value.allows.length === 0 ? [] : [{ label: 'Allowed doors', items: value.allows }]),
      ],
    },
  ],
});

export const loads = {
  id: 'loads',
  params,
  summary: 'Runtime loads from the selected files never reach the refused specifiers.',
  concern: 'loading',
  lists: [{ at: 'allows', item: specifier, key: specifier, identity: [] }],
  describe,
  map: mapProblem,
  shows,
  languages,
  reach: 'local',
  unit: 'selected file × refused specifier',
  limitations: [
    "A landing or a merge judges the selected files it changes, each re-read with everything it loads on both sides of the change. A changed file that is not selected — a workspace package's, or one outside `from` that a selected file loads — is judged for none of the files that load it. What it let in is recorded as an escape at the rule's next whole-reach measurement: after a landing that touches the rule's reach — the same landing, when the file stands in that reach — or at `enforce_rule`.",
    'The fingerprint names the selected file, so renaming or moving a file that carries debt is a new violation, refused at gate until `enforce_rule` absorbs it.',
    'Workspace packages are those of the manifest nearest above `base` that declares `workspaces`, a member being a directory with a manifest that its patterns match. A package is entered only through its `exports` map, or `main` where it has none; a specifier outside the workspace — a third-party package, a built-in — is judged as written and never entered.',
    "A specifier is refused as written: a file a refused door resolves to, reached by another spelling — a relative import inside its own package — is followed, not refused; and a built-in's bare and `node:` spellings are two entries.",
    "A `{ module }` entry of `from` stands for that module's territory under `base` in the module map the server assembles from the project's module cards, so a module whose root moves carries the judged files with it.",
    "A relative specifier resolves onto the first path the tree lists of the path as written, a `.js`, `.mjs` or `.cjs` ending read as `.ts`, the path with `.ts` or `.tsx` added, and `index.ts` under it; a bare specifier is looked up first through the `paths` and `baseUrl` of the tsconfig nearest `base`, and a config whose `extends` chain reaches a file the tree lacks reads its tracked source from `built`, or fails the inspection naming it where none is declared; a config inside a `node_modules` directory or outside the checkout, named by package or by path, is read from what the judging checkout has installed, links followed as TypeScript follows them and the same file for both sides, and fails the inspection naming it where nothing installed provides it. A relative or workspace specifier that lands on no listed file, an absolute one, and one naming a package's `imports` field (`#…`), is not followed, and the verdict names it in `unjudged`.",
    'An import whose every binding is marked `type` is erased, as Bun erases it; `require` is followed wherever it is called; `static` leaves only an `import()` call unfollowed.',
    'A reached file no import reader parses — JSON, CSS — reads as importing nothing. A reached text that is not UTF-8 or does not parse — a file embedding scripts with one never closed — and a workspace manifest that is not JSON fail the whole inspection.',
    'A violation names one shortest chain, taken at the earliest import line of each file on it; every other chain from the same file to the same refused entry shares its fingerprint, so a debt entry stands while any of them does.',
  ],
  unblock: [
    "Cut the chain the violation names: load a door `allows` names instead, or move what loads the refused specifier out of the selected files' reach.",
  ],
} as const;

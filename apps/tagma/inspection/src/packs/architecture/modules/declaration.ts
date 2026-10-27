import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { bare, base, baseOrRoot, built, defaulted, describeFiles, distinct, filesOrAll, query, runtimes } from '../../../core/params';
import { localEntry, type MapModule, type ModuleMap, type Shown } from '../../../core/rule';

const languages: Languages = 'any';

const files = filesOrAll(extensionsOf(languages));

const infix = Schema.String.check(Schema.isPattern(/^\.[A-Za-z0-9_-]+$/u)).annotate({
  description: 'A name infix marking a test file, such as `.test` in `x.test.ts`.',
});

const params = Schema.Struct({
  base: baseOrRoot,
  framework: Schema.optional(
    Schema.Array(
      Schema.String.check(
        Schema.isPattern(/^(?:\.\/(?!\.+$)[^\s/*]+|(?:@[^\s/@*]+\/[^\s/*]+|[^\s/.#@*][^\s/*]*)(?:\/[^\s/*]+)*(?:\/\*)?)$/u),
      ),
    ).annotate({
      description:
        'Virtual framework specifiers with no source file in the tree, treated like external packages. An exact name matches itself; a name ending in `/*` matches its subpaths; `./name` matches that sibling import written in any directory. Resolved files still undergo module checks.',
    }),
  ),
  queries: Schema.optional(
    Schema.Array(query)
      .check(Schema.makeFilter((queries) => (distinct(queries) ? undefined : 'a query is named once')))
      .annotate({
        description:
          'Query suffixes a bundler reads off an import, such as `?raw`: a specifier ending in one is resolved and judged as the file it names without it. An undeclared query stays part of the path.',
      }),
  ),
  runtimes: Schema.optional(runtimes),
  roots: Schema.optional(
    Schema.Array(base)
      .check(Schema.makeFilter((roots) => (new Set(roots).size === roots.length ? undefined : 'a root is named once')))
      .annotate({
        description:
          "Directories a bundler resolves a `/`-leading `import.meta.glob` pattern from, such as a Vite project's `root`, each from the repository root with no leading or trailing `/`, empty for the root itself. A file resolves such a pattern from the deepest one holding it; a glob in a file none holds is named in `unjudged`.",
      }),
  ),
  built: Schema.optional(
    built.annotate({
      description:
        'Exact built output files, relative to base, each with the tracked source that stands for it and the reason: an import landing on the output is judged at the source, and a config extending an output the tree lacks reads the source in its place. A missing source stays unresolved.',
    }),
  ),
  tests: Schema.optional(
    Schema.Array(infix)
      .check(Schema.makeFilter((infixes) => (new Set(infixes).size === infixes.length ? undefined : 'an infix is named once')))
      .annotate({
        description:
          "The infixes that mark a test file. A test belongs to its own path's module or, where no territory covers that path, to its subject's — its first name segment with its extension, `x.ts` for `x.store.test.ts`; absent, no file is a test.",
      }),
  ),
  cycles: defaulted(
    Schema.Literals(['refuse', 'allow']).annotate({
      description:
        'Whether the relations of the module map open to all code may close a cycle (`allow`) or must stand in an order (`refuse`); a `testing` relation closes none.',
    }),
    'refuse',
  ),
  coverage: defaulted(
    Schema.Literals(['refuse', 'allow']).annotate({
      description:
        'Whether a selected file of the region no territory covers, and an import landing on a path no territory covers, is a violation (`refuse`) or left unjudged (`allow`).',
    }),
    'refuse',
  ),
  unresolved: defaulted(
    Schema.Literals(['refuse', 'unjudged']).annotate({
      description:
        'Whether a literal import aiming under `base` that lands on no listed path is a violation (`refuse`) or named in `unjudged` (`unjudged`). A load whose target is known only at run time is named in `unjudged` under either.',
    }),
    'refuse',
  ),
  reads: defaulted(
    Schema.Literals(['from', 'runtime', 'every']).annotate({
      description:
        'Which import spellings count: `from` clauses, what survives compilation including dynamic imports and globs (`runtime`), or both with type-position imports (`every`).',
    }),
    'runtime',
  ),
  conditions: defaulted(
    Schema.Array(Schema.NonEmptyString).annotate({
      description:
        "The conditions a workspace package's `exports` map is read under, besides `default`, which always matches; absent, `default` alone.",
    }),
    [],
  ),
  files,
});

type Params = typeof params.Type;

export type Run = Params & { readonly map: ModuleMap };

export type Door = { readonly only: ReadonlySet<string> | null; readonly role: 'open' | 'port' | 'testing' };

export type Reach = { readonly test: boolean; readonly typeOnly: boolean };

export type Floor = { readonly entry: string; readonly floor: number };

export type Boundaries = {
  readonly ownerOf: (local: string) => string | undefined;
  readonly allows: (from: string, to: string, test: boolean) => boolean;
  readonly doorOf: (owner: string, local: string) => Door | undefined;
  readonly opens: (door: Door | undefined, consumer: string, reach: Reach) => boolean;
  readonly reaches: (consumer: string, owner: string, local: string, reach: Reach) => boolean;
  readonly isTest: (local: string) => boolean;
  readonly named: (local: string) => boolean;
  readonly consumerOf: (local: string) => string | undefined;
  readonly floorOf: (owner: string, local: string) => Floor | undefined;
};

export type Local = {
  readonly modules: readonly MapModule[];
  readonly relations: ModuleMap['relations'];
};

const inside = (path: string, dir: string): boolean => dir === '' || path === dir || path.startsWith(`${dir}/`);

const under = (base: string, paths: readonly string[]): string[] => paths.flatMap((path) => localEntry(base, path) ?? []);

export const localOf = (base: string, map: ModuleMap): Local => ({
  modules: map.modules.flatMap((one) => {
    const [first, ...rest] = under(base, one.territory);
    if (first === undefined) return [];
    const order = (one.order ?? []).flatMap((floor) => {
      const [low, ...more] = under(base, floor);
      return low === undefined ? [] : [[low, ...more] as const];
    });
    return [
      {
        id: one.id,
        territory: [first, ...rest] as const,
        entries: one.entries?.flatMap((door) => {
          const at = localEntry(base, door.at);
          return at === undefined ? [] : [{ ...door, at }];
        }),
        order: order.length === 0 ? undefined : order,
      },
    ];
  }),
  relations: map.relations,
});

const ancestorsOf = (path: string): readonly string[] => {
  const found = [path];
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) found.push(path.slice(0, cut));
  found.push('');
  return found;
};

const deepest = <T>(held: ReadonlyMap<string, T>, path: string): T | undefined => {
  for (const at of ancestorsOf(path)) {
    const found = held.get(at);
    if (found !== undefined) return found;
  }
  return undefined;
};

const WHOLE: Door = { only: null, role: 'open' };

const subjectOf = (local: string): string => {
  const cut = local.lastIndexOf('/');
  const name = local.slice(cut + 1);
  const first = name.indexOf('.');
  const last = name.lastIndexOf('.');
  return first <= 0 || first === last ? local : `${local.slice(0, cut + 1)}${name.slice(0, first)}${name.slice(last)}`;
};

const infixed = (tests: readonly string[], local: string): boolean => {
  const name = local.slice(local.lastIndexOf('/') + 1);
  const last = name.lastIndexOf('.');
  return last > 0 && tests.some((one) => name.slice(0, last).endsWith(one) || name.slice(0, last).includes(`${one}.`));
};

export const boundariesOf = (map: Local, tests: readonly string[] = []): Boundaries => {
  const owners = new Map(map.modules.flatMap((one) => one.territory.map((owned) => [bare(owned), one.id] as const)));
  const allowed = new Map(map.relations.map(({ from, to, role: kind }) => [`${from}\0${to}`, kind ?? 'open'] as const));
  const doors = new Map(
    map.modules.flatMap((one) =>
      one.entries === undefined
        ? []
        : [
            [
              one.id,
              new Map(
                one.entries.map(
                  ({ at, for: consumers, role: kind }) =>
                    [bare(at), { only: consumers === undefined ? null : new Set(consumers), role: kind ?? 'open' }] as const,
                ),
              ),
            ] as const,
          ],
    ),
  );
  const floors = new Map(
    map.modules.flatMap((one) =>
      one.order === undefined
        ? []
        : [
            [
              one.id,
              new Map(one.order.flatMap((floor, at) => floor.map((written) => [bare(written), { entry: written, floor: at }] as const))),
            ] as const,
          ],
    ),
  );
  const ownerOf = (local: string) => deepest(owners, local);
  const allows = (from: string, to: string, test: boolean) => {
    const kind = allowed.get(`${from}\0${to}`);
    return kind === 'open' || (kind === 'testing' && test);
  };
  const doorOf = (owner: string, local: string): Door | undefined => {
    const held = doors.get(owner);
    return held === undefined ? WHOLE : deepest(held, local);
  };
  const opens = (door: Door | undefined, consumer: string, reach: Reach): boolean => {
    if (door === undefined) return false;
    if (door.role === 'testing' && !reach.test) return false;
    if (door.role === 'port' && reach.typeOnly) return true;
    return door.only === null || door.only.has(consumer);
  };
  const named = (local: string): boolean => infixed(tests, local);
  const consumerOf = (local: string) => ownerOf(local) ?? (named(local) ? ownerOf(subjectOf(local)) : undefined);
  const isTest = (local: string): boolean => {
    if (named(local)) return true;
    const owner = ownerOf(local);
    return owner !== undefined && doorOf(owner, local)?.role === 'testing';
  };
  const floorOf = (owner: string, local: string): Floor | undefined => {
    const held = floors.get(owner);
    return held === undefined ? undefined : deepest(held, local);
  };
  return {
    ownerOf,
    allows,
    doorOf,
    opens,
    consumerOf,
    isTest,
    named,
    floorOf,
    reaches: (consumer, owner, local, reach) => {
      const door = doorOf(owner, local);
      if (consumer === owner) return true;
      if (door?.role === 'testing') return opens(door, consumer, reach);
      return allows(consumer, owner, reach.test) && opens(door, consumer, reach);
    },
  };
};

const heldBoundaries = new WeakMap<Run, Boundaries>();

export const boundariesFor = (params: Run): Boundaries => {
  let held = heldBoundaries.get(params);
  if (held === undefined) {
    held = boundariesOf(localOf(params.base, params.map), params.tests);
    heldBoundaries.set(params, held);
  }
  return held;
};

export const crossesOrder = (from: Floor | undefined, to: Floor | undefined): boolean =>
  from !== undefined && to !== undefined && from.entry !== to.entry && from.floor <= to.floor;

const cycleOf = (relations: ModuleMap['relations']): readonly string[] | undefined => {
  const next = new Map<string, string[]>();
  for (const { from, to, role } of relations) if (role !== 'testing') next.set(from, [...(next.get(from) ?? []), to]);
  const state = new Map<string, 'open' | 'done'>();
  const trail: string[] = [];
  const visit = (at: string): readonly string[] | undefined => {
    state.set(at, 'open');
    trail.push(at);
    for (const to of next.get(at) ?? []) {
      if (state.get(to) === 'open') return [...trail.slice(trail.indexOf(to)), to];
      if (state.get(to) === undefined) {
        const found = visit(to);
        if (found !== undefined) return found;
      }
    }
    trail.pop();
    state.set(at, 'done');
    return undefined;
  };
  for (const from of [...next.keys()].sort()) {
    if (state.get(from) !== undefined) continue;
    const found = visit(from);
    if (found !== undefined) return found;
  }
  return undefined;
};

const mapProblem = (value: Params, map: ModuleMap): string | undefined => {
  const ids = map.modules.map((one) => one.id);
  if (new Set(ids).size !== ids.length) return 'a module is named once';
  if (!distinct(map.modules.flatMap((one) => one.territory))) return 'a territory entry belongs to one module, once';
  const known = new Set(ids);
  for (const one of map.modules) {
    const entries = one.entries ?? [];
    if (!distinct(entries.map(({ at }) => at))) return `an entry of \`${one.id}\` is named once`;
    for (const { at, for: consumers = [] } of entries) {
      if (!one.territory.some((owned) => inside(bare(at), bare(owned))))
        return `the entry \`${at}\` of \`${one.id}\` lies outside its territory`;
      const stranger = consumers.find((consumer) => !known.has(consumer));
      if (stranger !== undefined) return `the entry \`${at}\` of \`${one.id}\` is open to \`${stranger}\`, which is no module here`;
      if (new Set(consumers).size !== consumers.length) return `the entry \`${at}\` of \`${one.id}\` names a module twice`;
    }
    const floors = (one.order ?? []).flat();
    if (!distinct(floors)) return `an order entry of \`${one.id}\` stands on one floor, once`;
    const outside = floors.find((at) => !one.territory.some((owned) => inside(bare(at), bare(owned))));
    if (outside !== undefined) return `the order entry \`${outside}\` of \`${one.id}\` lies outside its territory`;
  }
  const pairs = new Set<string>();
  for (const { from, to } of map.relations) {
    const stranger = [from, to].find((end) => !known.has(end));
    if (stranger !== undefined) return `the relation \`${from}\` -> \`${to}\` names \`${stranger}\`, which is no module here`;
    if (from === to) return `\`${from}\` has a relation to itself; a file imports its own module freely`;
    if (pairs.has(`${from}\0${to}`)) return `the relation \`${from}\` -> \`${to}\` is named twice`;
    pairs.add(`${from}\0${to}`);
  }
  if (value.cycles === 'refuse') {
    const cycle = cycleOf(map.relations);
    if (cycle !== undefined)
      return `the relations close a cycle, ${cycle.map((one) => `\`${one}\``).join(' -> ')}, and \`cycles\` refuses one`;
  }
  return undefined;
};

const localTo = (base: string, path: string): string | undefined =>
  base === '' ? path : path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;

export const inRegion = (value: Run, path: string): boolean => {
  const local = localTo(value.base, path);
  return local !== undefined && value.map.region.some((one) => inside(path, bare(one)));
};

const MANIFEST = 'package.json';

const relevant = (value: Run, path: string): boolean =>
  localTo(value.base, path) !== undefined ||
  (path.endsWith(MANIFEST) && (path === MANIFEST || value.base.startsWith(`${path.slice(0, -MANIFEST.length - 1)}/`)));

const READS = {
  from: 'imports written with a `from` clause',
  runtime: 'imports that survive compilation',
  every: 'every import, type-only ones included',
} as const satisfies Record<Params['reads'], string>;

const COVERAGE = {
  refuse: 'A selected file of the region no territory covers, and an import landing on a path no territory covers, is a violation.',
  allow: 'A selected file no territory covers is not judged, and an import landing on one is named unjudged.',
} as const satisfies Record<Params['coverage'], string>;

const UNRESOLVED = {
  refuse: 'A literal import aiming under the base that lands on no file is a violation.',
  unjudged: 'A literal import aiming under the base that lands on no file is named unjudged.',
} as const satisfies Record<Params['unresolved'], string>;

const RUNTIME_LOADS =
  'A load whose target is known only at run time — a nonliteral load, a glob with options beyond `eager` and `import`, a glob pattern neither relative nor resolved from a root — is named unjudged.';

const rootsSaid = (roots: readonly string[] | undefined): string =>
  roots === undefined || roots.length === 0
    ? 'a relative pattern from its file'
    : `a relative pattern from its file and a \`/\`-leading one from the deepest of ${roots.map((root) => (root === '' ? 'the repository root' : `\`${root}\``)).join(', ')} holding the file`;

const CYCLES = {
  refuse: 'The relations open to all code stand in an order; a `testing` relation, which lets test code alone import, stands outside it.',
  allow: 'The relations may close a cycle.',
} as const satisfies Record<Params['cycles'], string>;

const describe = (value: Params): string => {
  const conditions = [...(value.conditions ?? []), 'default'].map((at) => `\`${at}\``).join(', ');
  const tests =
    value.tests === undefined || value.tests.length === 0
      ? ''
      : ` A file named with ${value.tests.map((one) => `\`${one}\``).join(', ')}, or lying under a \`testing\` entry of its own module, is test code: it imports what its module may, along its \`testing\` relations too, and any module's \`testing\` entries besides.`;
  return [
    `Module boundaries ${describeFiles(value.base, value.files)}, reading ${READS[value.reads]}, with literal globs expanded into an import of each matching file — ${rootsSaid(value.roots)} — resolved as relative paths or workspace packages (\`exports\` read under ${conditions}), over the module map the project's module cards draw: a file belongs to the module whose territory entry covering it is the longest, imports its own module freely and down its module's \`order\` alone, and imports another module only along a relation and only through that module's entries.${tests} ${COVERAGE[value.coverage]} ${UNRESOLVED[value.unresolved]} ${RUNTIME_LOADS} ${CYCLES[value.cycles]}`,
    ...((value.framework?.length ?? 0) === 0
      ? []
      : [
          `Virtual framework imports treated as external when no file resolves: ${value.framework!.map((name) => `\`${name}\``).join(', ')}.`,
        ]),
    ...((value.queries?.length ?? 0) === 0
      ? []
      : [`An import ending in ${value.queries!.map((one) => `\`${one}\``).join(', ')} is judged as the file it names without it.`]),
    ...(value.built ?? []).map(({ output, source, why }) => `- Built output \`${output}\` stands as \`${source}\`: ${why}`),
  ].join('\n');
};

const shows = (value: Run): Shown => ({
  figures: [
    {
      kind: 'modules',
      modules: value.map.modules.map((one) => ({
        id: one.id,
        territory: one.territory,
        entries:
          one.entries === undefined
            ? null
            : one.entries.map((door) => ({
                at: door.at,
                for: door.for,
                role: door.role,
              })),
      })),
      relations: value.map.relations.map(({ from, to, role }) => ({ from, to, role })),
    },
  ],
});

const renamedAt = (text: string, renamed: ReadonlyMap<string, string>, tails: readonly string[]) => {
  for (const [from, to] of renamed) if (tails.some((tail) => text.startsWith(`${from}${tail}`))) return `${to}${text.slice(from.length)}`;
  return text;
};

const modulesRenamed = (fingerprint: string, renamed: ReadonlyMap<string, string>): string | undefined => {
  const owned = renamedAt(fingerprint, renamed, [' -> ', ' order ']);
  const arrow = owned.indexOf(' -> ') + ' -> '.length;
  const moved = arrow < ' -> '.length ? owned : `${owned.slice(0, arrow)}${renamedAt(owned.slice(arrow), renamed, [' @ ', ' private @ '])}`;
  return moved === fingerprint ? undefined : moved;
};

export const modules = {
  id: 'modules',
  params,
  summary: 'An import crosses into another module only along a relation of the module map, through an entry open to the importer.',
  concern: 'imports',
  describe,
  map: mapProblem,
  shows,
  relevant,
  follows: () => true,
  modulesRenamed,
  languages,
  reach: 'local',
  hides: 'nothing',
  unit: 'importing file × module it reaches, importing file × order entry it reaches, and a file or import target no territory covers',
  limitations: [
    "The modules, their territories, entries, order and relations are the module map the server assembles from the project's module cards; the rule stores its policy alone, and a module card changes through `set_module`. A file created where no territory reaches is uncovered until `set_module` gives it an owner.",
    "A file is read and its specifiers resolved by the adapter of its language: a relative specifier onto the first path the tree lists of the path as written, a `.js`, `.mjs` or `.cjs` ending read as `.ts`, the path with `.ts` or `.tsx` added, and `index.ts` under it; a tsconfig `paths` or `baseUrl` alias as TypeScript lands it, else onto the first path it aims at that the tree lists as written — a file of a format TypeScript does not read among them; a package's `imports` field through code-facts; any other specifier naming a member of the workspace through that package's `exports` map under `conditions` and `default`, or `main` where it has none. A specifier naming no member, or landing outside `base`, is not judged.",
    "Under `reads: runtime` or `every`, a literal dynamic import is judged like a static one. A literal `import.meta.glob` imports every matching listed file, eager and lazy alike, with `!` exclusions applied across the whole pattern set: a source-relative pattern (`./` or `../`) from its file, a `/`-leading one from the deepest of `roots` holding the file, as the bundler resolves it from its project root; targets outside `base` remain outside judgement. Its specifier keeps the patterns as written. Where the bundler's root lies is the build's choice — Vite's `root` option, else the directory it runs in — and the tree alone does not fix it, so a `/`-leading pattern is resolved only from a declared root. Only literal `eager` and `import` options are supported. A load whose target is known only at run time is no module relation and is named in `unjudged` under either `unresolved` policy: a nonliteral `import()` or `require()`, a glob with other options, an alias or bare pattern, a `/`-leading pattern no root holds, or any glob in a tree unable to list its targets. An empty match set imports nothing. Glob candidates count against the inspection envelope.",
    'The `framework` policy declares virtual import names supplied by a framework rather than files in the tree. An exact name matches itself; `name/*` matches nonempty subpaths only; `./name` matches that specifier as written in any directory, for a file the framework generates beside each importer. Only unresolved imports are classified as external: a resolved alias or workspace entry still undergoes every module check. Undeclared names keep the `unresolved` policy.',
    'A declared query is cut off the end of a specifier before it is resolved, so the import lands on the file it names and undergoes every module check there; its fingerprint keeps the specifier as written. Only an exact trailing query is cut: one followed by another query, or a query `queries` does not name, stays part of the path.',
    'A declared built output is judged at its exact source path, whether the output is listed or absent. The source must be listed, and its module relation, entry and testing restrictions still apply; the mapping proves no correspondence between source and emitted bytes.',
    "A tsconfig whose `extends` chain reaches by path a file the tree lacks — one the build generates and git ignores — reads that file's text from the source a `built` entry declares for it, as if it stood at the output's path, so a verbatim copy of the generated config serves; the copy is named `.json`, and a change to it or to the output's path judges again, region or not, the files that resolve through it. Without such an entry, or with its source absent, the inspection fails naming the config and the missing file, never reading the config without it. Where the judging checkout holds the generated output itself, a copy whose parsed config differs from it in anything, `paths` order included, fails the inspection naming both files; the output is taken as that checkout holds it, generated whenever its tool last ran there, and a merge compares against its own worktree's. Only the side under judgement is compared, so the commit that brings the copy in line lands. The copy lands in a commit of its own before the entry naming it: a commit's base side reads the configs its base holds.",
    "An `extends` chain reaching a config inside a `node_modules` directory or outside the checkout — by package name, as TypeScript resolves one, or by path — that neither the tree nor a workspace member holds reads it from what the judging checkout has installed: installed packages are the checkout's environment, not judged code, so the base and the judged side read the same installed file and no `built` entry is needed. A link is followed to where it lands, inside the checkout or out of it, and the chain resolves on from there, as TypeScript follows it; a `built` entry whose output is such a path keeps its copy in that place. A config nothing installed provides fails the inspection naming the config and what its chain names: install the checkout's dependencies. The importer index keeps what each installed file it read held, and before it is used again a file that changed, appeared or went away re-resolves the files that resolved through it.",
    'An uncovered file is one violation placed at its first line, and its own imports are not read. Under `coverage: refuse` an import landing on a path no territory covers — a `.json` asset included — is a violation; under `allow` it is named in `unjudged`.',
    'A `port` entry tells types from values by the import site: an import erased at compilation — `import type`, or every binding marked `type` — reads its types; any other reads its values.',
    "A module's `order` judges the imports inside it: a file stands on the floor of the longest order entry covering it, imports from a lower floor or its own entry, never from a floor above or another entry of its own floor, and a file no entry covers is free. Every selected file not named as a test is judged, a file under a `testing` entry included.",
    "Fingerprints: `<consumer> -> <target> @ <file>` for an import no relation allows, `<consumer> -> <target> private @ <file>` for one that reaches no entry open to the consumer, `<module> order <file> -> <entry>` for one that climbs its module's order, `<consumer> -> <path> unowned @ <file>` for one landing on a path no territory covers, `<consumer> -> <specifier> unresolved @ <file>` and `uncovered @ <file>`, each path relative to `base`. Debt is therefore a set of files per edge: another import along an indebted edge from an indebted file stands, and a file that newly takes the edge is new. A module whose id `set_module` changes keeps its debt under the new id.",
    'A deleted file whose import-free body arrives unchanged at another path is followed there: its violations stand at the new path when they keep their consumer, target and kind, and the verdict names the pair, so the debt moves with it. A file rewritten on the way, or moved into another module’s territory, is judged new; a wave moves a file first and rewrites it in a second commit.',
    'A removed path or a resolution-relevant manifest change also judges unchanged consumers whose imports land differently. Package export changes select users of changed bindings; adding a fresh entry refreshes unresolved users without judging existing consumers, while an entry overriding a wildcard rejudges its users. Other resolver-input changes select the files that depend on them. Scripts and dependency ranges preserving declared names do not change resolution. A changed glob match set rejudges its unchanged importer on additions and removals; its watches follow pattern roots, including patterns that matched nothing. Other added paths refresh watched resolution facts before the index advances; without a reusable index their changes in unchanged importers are judged at the next whole-reach measurement.',
    'Cycles are judged on the relations open to all code, not on measured imports: with every import a relation or standing debt, a new cycle comes in only through an import that is itself a violation; a relation that closes a cycle under `cycles: refuse` is refused where the module map is written. A `testing` relation closes no cycle: it lets test code alone import, so a lower module may be tested through one above it.',
    'Source probes retained for this judgement or in its validated importer index are reused. The importer index is built once per resolution policy and territory, then advances by the tree delta. Entry and relation changes keep that resolution index: a module-card change judges importers of narrowed target entries, source files losing their testing role, and the files already named by debt or escapes. Territory and order changes measure the full reach.',
    'A selected file whose text is not UTF-8 or does not parse fails the whole inspection, never reads as a file importing nothing; `files.exclude` naming it is the way past.',
  ],
  unblock: [
    "Import another module only along a relation and only through its entries: move the code to the module that owns its meaning, or reach it through the port or hook the lower module declares; import another module's `testing` entry only from test code; import down your module's order; place a new file under its module's territory, or give it one with `set_module`; make an unresolved import name a file the tree holds.",
  ],
} as const;

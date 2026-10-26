import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative } from 'node:path';
import type { Problem } from '@runlith/navigation/adapter';
import type { API, Diagnostic, Project, Snapshot } from 'typescript7/async';

export type Apart = 'none' | 'apart' | 'linked' | 'degraded';

const apart = (assigned: string): assigned is Apart =>
  assigned === 'none' || assigned === 'apart' || assigned === 'linked' || assigned === 'degraded';

type Entry = {
  readonly files: readonly string[];
  readonly declarations: readonly string[];
  readonly problems: readonly Problem[];
  readonly degraded: boolean;
};

type Holders = ReadonlyMap<string, readonly string[]>;

export type Catalog = {
  readonly record: (projects: readonly Project[]) => Promise<Catalog>;
  readonly forget: (configs: readonly string[]) => Catalog;
  readonly touched: (paths: readonly string[], open: ReadonlySet<string>) => Catalog;
  readonly outdated: (open: ReadonlySet<string>) => Catalog;
  readonly within: (checkout: string) => Catalog;
  readonly stale: (config: string) => boolean;
  readonly renewing: (files: readonly string[]) => readonly string[];
  readonly configs: () => readonly string[];
  readonly problems: () => readonly Problem[];
  readonly holds: (file: string) => boolean;
  readonly configFor: (file: string, near: readonly string[]) => string | undefined;
  readonly assign: (files: readonly string[], near: readonly string[]) => ReadonlyMap<string, string | Apart>;
  readonly degraded: (config: string) => boolean;
  readonly absolute: (path: string) => string;
  readonly relative: (file: string) => string;
  readonly same: (left: string, right: string) => boolean;
  readonly real: (key: string) => string | undefined;
};

export type View = {
  readonly snapshot: Snapshot;
  readonly catalog: Catalog;
  readonly open: ReadonlySet<string>;
  readonly projectFor: (file: string, near: readonly string[]) => Project | undefined;
  readonly assign: (files: readonly string[], near: readonly string[]) => ReadonlyMap<string, Project | Apart>;
  readonly wants: (files: readonly string[], near: readonly string[]) => readonly string[];
};

const packageOf = (root: string, file: string): string | undefined => {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dir === root || dirname(dir) === dir) return undefined;
  }
};

const holdsUnder = (sorted: readonly string[], prefix: string): boolean => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? '') < prefix) low = middle + 1;
    else high = middle;
  }
  return (sorted[low] ?? '').startsWith(prefix);
};

const DEGRADING = new Set([5101, 5102, 5107, 5108, 5110]);

const UNREADABLE = 5083;

const messageOf = (diagnostic: Diagnostic): string => `TS${diagnostic.code}: ${diagnostic.text}`;

const missingFile = (message: string): string | undefined => /'([^']+)'/.exec(message)?.[1];

const DEPENDENCIES = /"(?:dependencies|devDependencies|peerDependencies)"\s*:\s*\{\s*"/;

const lacksModules = (root: string, from: string): boolean => {
  let manifest: string | undefined;
  for (let dir = from; ; dir = dirname(dir)) {
    if (manifest === undefined && existsSync(join(dir, 'package.json'))) manifest = join(dir, 'package.json');
    if (existsSync(join(dir, 'node_modules'))) return false;
    if (dir === root || dirname(dir) === dir) break;
  }
  return manifest !== undefined && DEPENDENCIES.test(readFileSync(manifest, 'utf8'));
};

const generatedPath = (root: string, file: string): boolean => {
  const inside = relative(root, file);
  if (inside.startsWith('..') || isAbsolute(inside)) return false;
  const ignored = Bun.spawnSync(['git', 'check-ignore', '-q', inside], { cwd: root, stdout: 'ignore', stderr: 'ignore' });
  return ignored.exitCode === 0;
};

const problemsOf = async (root: string, project: Project): Promise<readonly Problem[]> => {
  const config = project.configFileName;
  if (config === undefined) return [];
  const where = posix.normalize(relative(root, config));
  const [parsing, options] = await Promise.all([
    project.program.getConfigFileParsingDiagnostics(),
    project.program.getProgramDiagnostics(),
  ]);
  const found: Problem[] = [];
  for (const diagnostic of parsing) {
    const detail = messageOf(diagnostic);
    const missing = diagnostic.code === UNREADABLE ? missingFile(detail) : undefined;
    found.push({ project: where, problem: missing !== undefined && generatedPath(root, missing) ? 'generated' : 'config', detail });
  }
  for (const diagnostic of options)
    if (DEGRADING.has(diagnostic.code)) found.push({ project: where, problem: 'degraded', detail: messageOf(diagnostic) });
  if (lacksModules(root, dirname(config)))
    found.push({
      project: where,
      problem: 'dependencies',
      detail: `no node_modules above ${posix.normalize(relative(root, dirname(config))) || '.'}`,
    });
  const merged = new Map<string, Problem>();
  for (const one of found) {
    const held = merged.get(one.problem);
    merged.set(one.problem, held === undefined ? one : { ...held, detail: `${held.detail}; ${one.detail}` });
  }
  return [...merged.values()];
};

export const makeCatalog = (api: API, root: string): Catalog => {
  const canonical = (file: string) => api.getCanonicalFileName(file);
  const reals = new Map<string, string>();

  const depth = (config: string, file: string) => {
    const dir = canonical(dirname(config));
    return file.startsWith(`${dir}/`) ? dir.length : -1;
  };

  const recorded = async (projects: readonly Project[]) => {
    const named = projects.flatMap((project) =>
      project.configFileName === undefined ? [] : [{ project, config: project.configFileName }],
    );
    const [names, problems] = await Promise.all([
      Promise.all(named.map(({ project }) => project.program.getSourceFileNames())),
      Promise.all(named.map(({ project }) => problemsOf(root, project))),
    ]);
    return named.map(({ config }, at): [string, Entry] => {
      const files = (names[at] ?? []).map((file) => {
        const key = canonical(file);
        reals.set(key, file);
        return key;
      });
      const found = problems[at] ?? [];
      return [
        config,
        {
          files,
          declarations: files.filter((key) => key.endsWith('.d.ts')).sort(),
          problems: found,
          degraded: found.some((one) => one.problem === 'degraded'),
        },
      ];
    });
  };

  const build = (entries: ReadonlyMap<string, Entry>, stale: ReadonlySet<string>, checkout: string): Catalog => {
    let holders: Holders | undefined;

    const index = (): Holders => {
      if (holders !== undefined) return holders;
      const built = new Map<string, string[]>();
      for (const [config, entry] of entries)
        for (const file of entry.files) {
          const list = built.get(file) ?? [];
          list.push(config);
          built.set(file, list);
        }
      const degraded = (config: string) => Number(entries.get(config)?.degraded ?? false);
      const size = (config: string) => entries.get(config)?.files.length ?? 0;
      for (const [file, list] of built)
        list.sort((left, right) => degraded(left) - degraded(right) || depth(right, file) - depth(left, file) || size(right) - size(left));
      holders = built;
      return built;
    };

    const degraded = (config: string) => entries.get(config)?.degraded ?? false;

    const configFor = (file: string, near: readonly string[]) => {
      const all = index();
      const list = all.get(canonical(file));
      if (list === undefined) return undefined;
      const wanted = near.map(canonical);
      return list.find((config) => !degraded(config) && wanted.every((one) => all.get(one)?.includes(config) ?? false)) ?? list[0];
    };

    const home = (key: string): string | undefined => {
      let found: string | undefined;
      for (const config of entries.keys()) if (depth(config, key) > (found === undefined ? -1 : depth(found, key))) found = config;
      return found;
    };

    const catalog: Catalog = {
      record: async (projects) => {
        if (projects.length === 0) return catalog;
        const fresh = await recorded(projects);
        const renewed = new Set(fresh.map(([config]) => config));
        return build(new Map([...entries, ...fresh]), new Set([...stale].filter((config) => !renewed.has(config))), checkout);
      },
      forget: (configs) =>
        configs.some((config) => entries.has(config))
          ? build(new Map([...entries].filter(([config]) => !configs.includes(config))), stale, checkout)
          : catalog,
      touched: (paths, open) => {
        const all = index();
        const dirty = new Set(stale);
        for (const path of paths) {
          const key = canonical(path);
          for (const config of all.get(key) ?? []) if (!open.has(config)) dirty.add(config);
          const at = home(key);
          if (at !== undefined && !open.has(at)) dirty.add(at);
        }
        return dirty.size === stale.size ? catalog : build(entries, dirty, checkout);
      },
      outdated: (open) => build(entries, new Set([...stale, ...[...entries.keys()].filter((config) => !open.has(config))]), checkout),
      within: (other) => (other === checkout ? catalog : build(entries, stale, other)),
      stale: (config) => stale.has(config) || !entries.has(config),
      renewing: (files) => {
        if (stale.size === 0) return [];
        const all = index();
        const found = new Set<string>();
        for (const file of files) {
          const key = canonical(file);
          for (const config of all.get(key) ?? []) if (stale.has(config)) found.add(config);
          const at = home(key);
          if (at !== undefined && stale.has(at)) found.add(at);
        }
        return [...found];
      },
      configs: () => [...entries.keys()],
      problems: () => [...entries.values()].flatMap((entry) => entry.problems),
      holds: (file) => index().has(canonical(file)),
      configFor,
      assign: (files, near) => {
        const all = index();
        const wanted = near.map(canonical);
        const packages = [...new Set(near.flatMap((file) => packageOf(root, file) ?? []))].map((dir) => `${canonical(dir)}/`);
        const assigned = new Map<string, string | Apart>();
        const open = new Map<string, readonly string[]>();
        for (const file of files) {
          const list = all.get(canonical(file));
          if (list === undefined) {
            assigned.set(file, 'none');
            continue;
          }
          const sharing = list.filter((config) => wanted.every((one) => all.get(one)?.includes(config) ?? false));
          if (sharing.length > 0) {
            open.set(file, sharing);
            continue;
          }
          const linked = list.some((config) => packages.some((prefix) => holdsUnder(entries.get(config)?.declarations ?? [], prefix)));
          assigned.set(file, list.some(degraded) ? 'degraded' : linked ? 'linked' : 'apart');
        }
        while (open.size > 0) {
          const cover = new Map<string, number>();
          for (const list of open.values()) for (const config of list) cover.set(config, (cover.get(config) ?? 0) + 1);
          const [chosen] = [...cover].sort(
            ([left, leftCount], [right, rightCount]) =>
              Number(degraded(left)) - Number(degraded(right)) ||
              rightCount - leftCount ||
              (entries.get(left)?.files.length ?? 0) - (entries.get(right)?.files.length ?? 0),
          )[0] as [string, number];
          for (const [file, list] of open) {
            if (!list.includes(chosen)) continue;
            assigned.set(file, degraded(chosen) ? 'degraded' : chosen);
            open.delete(file);
          }
        }
        return assigned;
      },
      degraded,
      absolute: (path) => {
        if (isAbsolute(path)) return path;
        const based = join(root, path);
        if (checkout === root) return based;
        const own = join(checkout, path);
        return index().has(canonical(own)) && !index().has(canonical(based)) ? own : based;
      },
      relative: (file) => posix.normalize(relative(file.startsWith(`${checkout}/`) ? checkout : root, file)),
      same: (left, right) => canonical(left) === canonical(right),
      real: (key) => reals.get(key),
    };
    return catalog;
  };

  return build(new Map(), new Set(), root);
};

export const makeView = (catalog: Catalog, snapshot: Snapshot): View => {
  const projects = new Map<string, Project>();
  for (const project of snapshot.getProjects()) if (project.configFileName !== undefined) projects.set(project.configFileName, project);
  return {
    snapshot,
    catalog,
    open: new Set(projects.keys()),
    projectFor: (file, near) => {
      const config = catalog.configFor(file, near);
      return config === undefined ? undefined : projects.get(config);
    },
    assign: (files, near) =>
      new Map([...catalog.assign(files, near)].map(([file, config]) => [file, apart(config) ? config : (projects.get(config) ?? 'none')])),
    wants: (files, near) => {
      const wanted = new Set<string>(catalog.renewing([...files, ...near]));
      for (const config of catalog.assign(files, near).values()) if (!apart(config)) wanted.add(config);
      for (const file of near) {
        const config = catalog.configFor(file, []);
        if (config !== undefined) wanted.add(config);
      }
      return [...wanted];
    },
  };
};

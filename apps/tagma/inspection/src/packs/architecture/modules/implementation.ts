import type { Adapters } from '@runlith/code-facts/adapter';
import type { ImportEdge } from '@runlith/code-facts/imports';
import { sitesOf, type Tree } from '@runlith/code-facts/tree';
import { affectedFiles, builtSources, mapFiles, probeFiles, probeKey } from './probes';
import { accessDelta, ledgerPaths } from './access';
import type { Budget } from '../../../core/node/budget';
import type { Implementation } from '../../../core/node/reading';
import { localOf as pathUnder, picks, prefixOf } from '../../../core/node/select';
import { type Unjudged, unitsOf, type Violation } from '../../../core/verdict';
import { localEntry } from '../../../core/rule';
import { type Boundaries, boundariesFor, crossesOrder, type Door, type Floor, inRegion, type Reach, type Run } from './declaration';

const selects = (params: Run, path: string): boolean => {
  const local = pathUnder(params.base, path);
  return local !== undefined && inRegion(params, path) && picks(params.files, local);
};

const aimsUnder = (params: Run, path: string): boolean => path === params.base || pathUnder(params.base, path) !== undefined;

const siteOf = (line: number, specifier: string): string => `${line}\0${specifier}`;

type Judged = { readonly violations: readonly Violation[]; readonly unjudged: boolean };

const CLEAN: Judged = { violations: [], unjudged: false };

const edgesOf = (params: Run, tree: Tree, paths: readonly string[], adapters: Adapters, budget: Budget) => {
  const probes = probeFiles(params, tree, paths, adapters, budget);
  let read = {
    edges: probes.flatMap((one) => one.edges),
    unresolved: probes.flatMap((one) => one.unresolved),
    dynamic: probes.flatMap((one) => one.dynamic),
  };
  if (params.built !== undefined && params.built.length > 0) {
    const sources = builtSources(params);
    const edges: (typeof read.edges)[number][] = [];
    const unresolved: (typeof read.unresolved)[number][] = [];
    for (const edge of read.edges) {
      const source = sources.get(edge.to);
      if (source === undefined) edges.push(edge);
      else if (tree.has(source)) edges.push({ ...edge, to: source });
      else unresolved.push({ file: edge.file, line: edge.line, specifier: edge.specifier, unlisted: source, absent: [source] });
    }
    for (const miss of read.unresolved) {
      const source = sources.get(miss.unlisted);
      if (source !== undefined && tree.has(source)) edges.push({ file: miss.file, line: miss.line, specifier: miss.specifier, to: source });
      else unresolved.push(source === undefined ? miss : { ...miss, unlisted: source, absent: [source] });
    }
    read = { ...read, edges, unresolved };
  }
  if (params.framework !== undefined && params.framework.length > 0) {
    const exact = new Set(params.framework.filter((name) => !name.endsWith('/*')));
    const prefixes = params.framework.filter((name) => name.endsWith('/*')).map((name) => name.slice(0, -1));
    read = {
      ...read,
      unresolved: read.unresolved.filter(
        ({ specifier }) =>
          !exact.has(specifier) && !prefixes.some((prefix) => specifier.startsWith(prefix) && specifier.length > prefix.length),
      ),
    };
  }
  return read;
};

type Wording = { readonly message: string; readonly fix: string };

const rooted = (base: string, local: string): string => (base === '' ? local : local === '' ? `${base}/` : `${base}/${local}`);

const listed = (entries: readonly string[]): string => entries.map((one) => `\`${one}\``).join(', ');

const openTo = (params: Run, boundaries: Boundaries, owner: string, consumer: string, reach: Reach): readonly string[] =>
  (params.map.modules.find((one) => one.id === owner)?.entries ?? []).flatMap((door) =>
    localEntry(params.base, door.at) !== undefined &&
    boundaries.opens({ only: door.for === undefined ? null : new Set(door.for), role: door.role ?? 'open' }, consumer, reach)
      ? [door.at]
      : [],
  );

const orderFix = (params: Run, owner: string, from: Floor, above: Floor): string => {
  const lower = (params.map.modules.find((one) => one.id === owner)?.order ?? []).slice(0, from.floor).flat();
  const [here, there] = [rooted(params.base, from.entry), rooted(params.base, above.entry)];
  return `Import down the order of \`${owner}\`: move what this file needs from \`${there}\` onto a floor below \`${here}\`${lower.length === 0 ? '' : ` (${listed(lower)})`}, or reorder the floors with \`set_module\` where \`${there}\` truly stands lower.`;
};

type Importer = 'code' | 'test' | 'code of a test-only relation';

const unrelatedFinding = (specifier: string, consumer: string, owner: string, importer: Importer): Wording => {
  if (importer === 'code of a test-only relation')
    return {
      message: `imports \`${specifier}\` of module \`${owner}\`, which \`${consumer}\` may import from test code only`,
      fix: `Import \`${owner}\` only from test code, or open the relation \`${consumer} → ${owner}\` to all code with \`set_module\`.`,
    };
  const message = `imports \`${specifier}\` of module \`${owner}\`, which \`${consumer}\` has no relation to`;
  return importer === 'test'
    ? {
        message,
        fix: `Where the tests of \`${consumer}\` truly depend on \`${owner}\`, add the test-only relation \`${consumer} → ${owner}\` (\`imports-tests\`, written by \`importsTests\` of \`set_module\`), which leaves the code of \`${consumer}\` closed to \`${owner}\`; otherwise move this test to the module that owns its meaning.`,
      }
    : {
        message,
        fix: `Where \`${consumer}\` truly depends on \`${owner}\`, add the relation \`${consumer} → ${owner}\` with \`set_module\`; otherwise move this code to the module that owns its meaning, or reach it through a port \`${consumer}\` declares and composition fills.`,
      };
};

const privateFinding = (
  params: Run,
  boundaries: Boundaries,
  edge: { readonly specifier: string; readonly to: string },
  consumer: string,
  owner: string,
  door: Door | undefined,
  reach: Reach,
): Wording => {
  const open = openTo(params, boundaries, owner, consumer, reach);
  const through =
    open.length === 0
      ? `open an entry of \`${owner}\` covering \`${edge.to}\` to \`${consumer}\` with \`set_module\`, or move the code to the module that owns its meaning`
      : `import through an entry \`${owner}\` opens to \`${consumer}\` (${listed(open)}), or open one covering \`${edge.to}\` with \`set_module\``;
  if (door?.role === 'port' && boundaries.opens(door, consumer, { ...reach, typeOnly: true }))
    return {
      message: `imports values of \`${edge.specifier}\` through a port entry of \`${owner}\`, open to \`${consumer}\` for types only`,
      fix: `Import only its types with \`import type\`, or ${through}.`,
    };
  if (door?.role === 'testing' && !reach.test)
    return {
      message: `imports \`${edge.specifier}\`, a testing entry of \`${owner}\`, from code that is no test`,
      fix: `Import it only from test code, or ${through}.`,
    };
  return {
    message: `imports \`${edge.specifier}\` of module \`${owner}\`, which no entry of \`${owner}\` opens to \`${consumer}\``,
    fix: `${through[0]!.toUpperCase()}${through.slice(1)}.`,
  };
};

const unresolvedFix = (allowed: readonly string[]): string =>
  allowed.length === 0
    ? 'Point the import at a file the tree holds; a virtual framework import goes into `framework`, a bundler query into `queries`, a built output into `built`.'
    : `Land ${allowed.length === 1 ? '' : 'one of '}${listed(allowed)} with this change, or point the import at a file the tree holds.`;

const read = (params: Run, tree: Tree, paths: readonly string[], adapters: Adapters, budget: Budget) => {
  const boundaries = boundariesFor(params);
  const prefix = prefixOf(params.base);
  const violations: Violation[] = [];
  const unjudged: Unjudged[] = [];
  const owned: string[] = [];
  for (const path of new Set(paths)) {
    if (!selects(params, path)) continue;
    const local = path.slice(prefix.length);
    if (boundaries.consumerOf(local) !== undefined) {
      owned.push(path);
    } else if (params.coverage === 'refuse') {
      const directory = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : path;
      violations.push({
        fingerprint: `uncovered @ ${local}`,
        file: path,
        line: 1,
        message: "lies in no module's territory",
        fix: `Give it an owner: add \`${directory}\` or the file to the territory of the module that owns its meaning with \`set_module\`, or draw a module card for it.`,
      });
    }
  }
  const loading = new Map<string, ReadonlySet<string>>();
  const loads = (file: string, line: number, specifier: string): boolean => {
    let held = loading.get(file);
    if (held === undefined) {
      held = new Set(
        sitesOf(tree, file, adapters)
          .filter((site) => site.loads !== 'never')
          .map((site) => siteOf(site.line, site.specifier)),
      );
      loading.set(file, held);
    }
    return held.has(siteOf(line, specifier));
  };
  const judged = ({ file, line, specifier, to }: ImportEdge): Judged => {
    const target = pathUnder(params.base, to);
    if (target === undefined) return CLEAN;
    const local = file.slice(prefix.length);
    const consumer = boundaries.consumerOf(local) as string;
    const owner = boundaries.ownerOf(target);
    if (owner === undefined) {
      return params.coverage === 'refuse'
        ? {
            violations: [
              {
                fingerprint: `${consumer} -> ${target} unowned @ ${local}`,
                file,
                line,
                specifier,
                message: `imports \`${specifier}\`, landing on \`${to}\`, which no module's territory covers`,
                fix: `Give \`${to}\` an owner: add it or its directory to the territory of the module that owns it with \`set_module\`.`,
              },
            ],
            unjudged: false,
          }
        : { violations: [], unjudged: true };
    }
    const found: Violation[] = [];
    if (owner === consumer && !boundaries.named(local)) {
      const from = boundaries.floorOf(owner, local);
      const above = boundaries.floorOf(owner, target);
      if (from !== undefined && above !== undefined && crossesOrder(from, above))
        found.push({
          fingerprint: `${owner} order ${local} -> ${above.entry}`,
          file,
          line,
          specifier,
          message: `imports \`${specifier}\` from \`${rooted(params.base, above.entry)}\`, on or above the floor of \`${rooted(params.base, from.entry)}\` in the order of \`${owner}\``,
          fix: orderFix(params, owner, from, above),
        });
    }
    const door = boundaries.doorOf(owner, target);
    if (owner === consumer) return { violations: found, unjudged: false };
    const test = boundaries.isTest(local);
    const reach = { test, typeOnly: door?.role === 'port' && !loads(file, line, specifier) };
    if (boundaries.reaches(consumer, owner, target, reach)) return { violations: found, unjudged: false };
    const related = owner === consumer || boundaries.allows(consumer, owner, test) || (door?.role === 'testing' && test);
    const { message, fix } = related
      ? privateFinding(params, boundaries, { specifier, to }, consumer, owner, door, reach)
      : unrelatedFinding(
          specifier,
          consumer,
          owner,
          test ? 'test' : boundaries.allows(consumer, owner, true) ? 'code of a test-only relation' : 'code',
        );
    found.push({ fingerprint: `${consumer} -> ${owner}${related ? ' private' : ''} @ ${local}`, file, line, specifier, message, fix });
    return { violations: found, unjudged: false };
  };
  const { edges, unresolved, dynamic } = edgesOf(params, tree, owned, adapters, budget);
  for (const edge of edges) {
    const { violations: found, unjudged: loose } = judged(edge);
    violations.push(...found);
    if (loose) unjudged.push({ file: edge.file, line: edge.line, specifier: edge.specifier });
  }
  for (const { file, line, specifier } of dynamic) unjudged.push({ file, line, specifier });
  for (const { file, line, specifier, unlisted, absent } of unresolved) {
    if (!aimsUnder(params, unlisted)) continue;
    const local = file.slice(prefix.length);
    if (params.unresolved === 'unjudged') {
      unjudged.push({ file, line, specifier });
      continue;
    }
    const allowed = absent.filter((to) => {
      const { violations: found, unjudged: loose } = judged({ file, line, specifier, to });
      return found.length === 0 && !loose;
    });
    violations.push({
      fingerprint: `${boundaries.consumerOf(local) as string} -> ${specifier} unresolved @ ${local}`,
      file,
      line,
      specifier,
      absent: allowed.length === 0 ? undefined : allowed,
      message: `imports \`${specifier}\`, which lands on no file the tree holds`,
      fix: unresolvedFix(allowed),
    });
  }
  return { violations: unitsOf(violations), unjudged };
};

export const modules: Implementation<Run> = {
  lists: (params, adapters) => (adapters.some((adapter) => adapter.resolver !== undefined) ? [''] : [params.base]),
  reachKey: probeKey,
  selects,
  movable: (params, path) =>
    selects(params, path) && boundariesFor(params).consumerOf(path.slice(prefixOf(params.base).length)) !== undefined,
  read,
  remapped: (params, before, tree, fingerprints, adapters, budget, memo) => {
    const delta = accessDelta(before, params);
    if (delta === undefined) return undefined;
    const boundaries = boundariesFor(params);
    const was = boundariesFor(before);
    const prefix = prefixOf(params.base);
    const affected = mapFiles(
      params,
      tree,
      delta.targets,
      delta.sources,
      adapters,
      budget,
      memo,
      (path) => selects(params, path) && boundaries.consumerOf(path.slice(prefix.length)) !== undefined,
      (file, note) =>
        note.edges.some(({ to }) => {
          const target = builtSources(params).get(to) ?? to;
          const local = pathUnder(params.base, target);
          if (local === undefined) return false;
          const owner = boundaries.ownerOf(local);
          const source = file.slice(prefix.length);
          const consumer = boundaries.consumerOf(source);
          return (
            owner !== undefined &&
            consumer !== undefined &&
            [false, true].some(
              (typeOnly) =>
                was.reaches(consumer, owner, local, { test: was.isTest(source), typeOnly }) &&
                !boundaries.reaches(consumer, owner, local, { test: boundaries.isTest(source), typeOnly }),
            )
          );
        }),
    );
    return {
      paths: [...new Set([...ledgerPaths(params, fingerprints, tree.has), ...affected.paths])],
      footprint: { region: delta.targets.length > 0 || delta.sources.length > 0, files: affected.inputs },
    };
  },
  affected: (params, base, built, paths, adapters, budget, memo) => {
    const boundaries = boundariesFor(params);
    const prefix = prefixOf(params.base);
    return affectedFiles(
      params,
      base,
      built,
      paths,
      adapters,
      budget,
      memo,
      (path) => selects(params, path) && boundaries.consumerOf(path.slice(prefix.length)) !== undefined,
    );
  },
};

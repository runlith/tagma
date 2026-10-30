import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import type { Alias } from '../declarations/resolve';
import type { Side } from '@runlith/tagma/rules';
import { listedAt } from '../directories';
import { blobTexts, present } from '../git';
import { changesBetween, GOOD_ENOUGH, importersOf, prepare } from '../declarations/index';
import { packageOf } from '../declarations/corpus';
import { applyContributions, contributions, indexCoupling, type CouplingIndex } from './coupling';
import { lastIndex, lastWords, readIndex, readWords, saveIndex, saveWords, versionAt, type WordOrigins } from './cache';
import { moduleAt, production, selectSources, snapshots, within, type Module } from './snapshot';
import { vendorWords } from './strings';

const source = (path: string): boolean =>
  production(path) && (within(path, 'apps/tagma/server/src') || within(path, 'apps/tagma/app/src') || within(path, 'packages'));
const manifest = (path: string): boolean => posix.basename(path) === 'package.json';
const moduleShape = (module: Module | undefined): string =>
  JSON.stringify(module === undefined ? null : { id: module.id, paths: module.paths });

export const indexes = (root: string, revision: string) => {
  const version = versionAt(root, revision);
  const snapshot = snapshots(root);
  const known = new Map<string, CouplingIndex>();
  const recent = new Map<string, CouplingIndex>();
  const scope = (side: Side, revision: string, paths: readonly string[]) => snapshot({ ...side, commit: revision, paths, whole: false });
  const pathsIn = (revision: string, roots: readonly string[]): string[] =>
    roots.length === 0 ? [] : [...listedAt(root, revision, roots, true).keys()].filter(source);

  const coupling = (side: Side, aliases: readonly Alias[]): CouplingIndex => {
    const signature = createHash('sha256').update(JSON.stringify(aliases)).digest('hex');
    const prefix = `architecture:${version}:coupling:${signature}`;
    const key = `${prefix}:${side.commit}`;
    const held = known.get(key) ?? (side.whole ? undefined : readIndex(root, key));
    if (held !== undefined) {
      recent.set(prefix, held);
      return held;
    }
    if (side.whole) {
      prepare(root, side.commit, null);
      const index = indexCoupling(snapshot(side, ['']), side.commit, aliases);
      saveIndex(root, prefix, index);
      known.set(key, index);
      recent.set(prefix, index);
      return index;
    }
    const previous = recent.get(prefix) ?? lastIndex(root, prefix);
    if (previous === undefined || !present(root, [previous.revision]).has(previous.revision))
      throw new Error(
        'coupling has no revision index; run check_rules over all with inspection coupling to remeasure before judging a change',
      );
    const changes = changesBetween(root, previous.revision, side.commit);
    if (changes.filter((one) => source(one.path)).length > Math.max(GOOD_ENOUGH, side.paths.filter(source).length))
      throw new Error(
        'coupling has no nearby revision index; run check_rules over all with inspection coupling to remeasure before judging a change',
      );
    const metadata = changes.filter((one) => manifest(one.path) || (one.path.startsWith('.tagma/') && one.path.endsWith('.md')));
    const texts = blobTexts(root, [
      ...new Set(metadata.flatMap((one) => [one.before, one.after].filter((id): id is string => id !== null))),
    ]);
    let modules = [...previous.modules];
    let packages = [...previous.packages];
    const changedTerritories = new Set<string>();
    const changedPackages = new Set<string>();
    for (const change of metadata) {
      if (manifest(change.path)) {
        const directory = posix.dirname(change.path) === '.' ? '' : posix.dirname(change.path);
        const before = change.before === null ? undefined : packageOf(change.path, texts.get(change.before)!);
        const after = change.after === null ? undefined : packageOf(change.path, texts.get(change.after)!);
        packages = packages.filter((one) => one.dir !== directory);
        if (after !== undefined) packages.push(after);
        if (JSON.stringify(before) !== JSON.stringify(after)) changedPackages.add(directory);
      } else {
        const before = change.before === null ? undefined : moduleAt(change.path, texts.get(change.before)!);
        const after = change.after === null ? undefined : moduleAt(change.path, texts.get(change.after)!);
        if (before === undefined && after === undefined) continue;
        modules = modules.filter((one) => one.card !== change.path);
        if (after !== undefined) modules.push(after);
        if (moduleShape(before) !== moduleShape(after))
          for (const module of [before, after]) for (const source of module?.paths ?? []) changedTerritories.add(source.ref);
      }
    }
    const affected = new Set(changes.map((one) => one.path).filter(source));
    const targets = new Set(
      changes.filter((one) => source(one.path) && (one.before === null || one.after === null)).map((one) => one.path),
    );
    const roots = [...changedTerritories, ...changedPackages];
    for (const revision of [previous.revision, side.commit])
      for (const path of pathsIn(revision, roots)) {
        targets.add(path);
        if ([...changedTerritories].some((root) => within(path, root))) affected.add(path);
      }
    prepare(root, side.commit, previous.revision);
    if (targets.size > 0)
      for (const [revision, members] of [
        [previous.revision, previous.packages],
        [side.commit, packages],
      ] as const)
        for (const importer of importersOf(root, revision, targets, members, [], source)) affected.add(importer.path);
    const totals = structuredClone(previous.totals);
    if (affected.size > 0) {
      const paths = [...affected];
      applyContributions(totals, contributions(scope(side, previous.revision, paths), previous.modules, previous.packages, aliases), -1);
      applyContributions(totals, contributions(scope(side, side.commit, paths), modules, packages, aliases), 1);
    }
    const index: CouplingIndex = { revision: side.commit, modules, packages, totals };
    saveIndex(root, prefix, index);
    known.set(key, index);
    recent.set(prefix, index);
    return index;
  };

  const words = (side: Side, before?: string): readonly string[] => {
    const prefix = `architecture:${version}:vendor-declarations`;
    let index = readWords(root, `${prefix}:${side.commit}`);
    if (index === undefined || side.whole) {
      const accepts = (path: string): boolean =>
        production(path) && (/^packages\/adapter-[^/]+\//.test(path) || within(path, 'apps/tagma/server/src/external-harnesses/vendors'));
      let origins: WordOrigins;
      let paths: readonly string[];
      const whole = side.whole ? snapshot(side, ['packages', 'apps/tagma/server/src/external-harnesses/vendors']) : undefined;
      if (side.whole) {
        origins = {};
        paths = whole!.paths.filter(accepts);
      } else {
        const previous = (before === undefined ? undefined : readWords(root, `${prefix}:${before}`)) ?? lastWords(root, prefix);
        if (previous === undefined || !present(root, [previous.revision]).has(previous.revision))
          throw new Error(
            'vendor-ids has no declaration index; run check_rules over all with inspection vendor-ids to remeasure before judging a change',
          );
        origins = { ...previous.origins };
        paths = changesBetween(root, previous.revision, side.commit)
          .map((one) => one.path)
          .filter(accepts);
      }
      const changed = whole ?? snapshot({ ...side, paths, whole: false });
      const current = new Set(changed.paths);
      for (const path of paths) {
        const found = current.has(path) ? vendorWords(selectSources(changed, [path])) : [];
        if (found.length === 0) delete origins[path];
        else origins[path] = [...found];
      }
      index = { revision: side.commit, origins };
      saveWords(root, prefix, index);
    }
    return [...new Set(Object.values(index.origins).flat())].sort((a, b) => b.length - a.length || a.localeCompare(b));
  };

  return { coupling, words, snapshot };
};

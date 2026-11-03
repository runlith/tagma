import { createHash } from 'node:crypto';
import type { TreeDifference } from '@runlith/git/trees';
import type { Finding, Side } from '@runlith/tagma/rules';
import { NeedsPreparation } from '../../preparation';
import { isManifest } from '../../declarations/corpus';
import { blobTexts } from '../../git';
import {
  blobsAt,
  changesBetween,
  FAR,
  GOOD_ENOUGH,
  importersByName,
  importersOf,
  manifestsAt,
  movedPackages,
  prepare,
} from '../../declarations/index';
import { derivedMap, recentRoots, rootAt, seededMap, valueAt } from '../../maps';
import { versionAt } from '../cache';
import { production, snapshots, within } from '../snapshot';
import { callAnalysis, callFrontier, carrying, type Carriers, type Importers } from './analysis';
import type { CallParams } from './params';
import { inRegion, type World, worldOf } from './world';

const NEARBY = 6;

const sorted = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort((left, right) => (left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1));

const side = (commit: string, whole: boolean, paths: readonly string[] = []): Side => ({
  commit,
  whole,
  paths,
  read: async () => null,
  facts: null,
});

type Advance = {
  readonly id: string;
  readonly affected: ReadonlySet<string>;
  readonly before: World | undefined;
  readonly after: World | undefined;
  readonly relevant: Carriers;
};

let held: ReturnType<typeof snapshots> | undefined;
let heldRoot: string | undefined;
const snapshotsOf = (root: string): ReturnType<typeof snapshots> => {
  if (held === undefined || heldRoot !== root) {
    held = snapshots(root);
    heldRoot = root;
  }
  return held;
};

export const judgements = (root: string, params: CallParams, versionRevision: string) => {
  const signature = createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 16);
  const family = `calls:${versionAt(root, versionRevision)}:${signature}`;
  const snapshot = snapshotsOf(root);

  const carriersAt = (id: string): Carriers => ({ has: (path) => valueAt(root, id, `k:${path}`) !== undefined });

  const importersAcross =
    (...revisionsOf: readonly string[]): Importers =>
    (targets) => {
      const found = new Set<string>();
      for (const revision of new Set(revisionsOf))
        for (const one of importersOf(root, revision, targets, manifestsAt(root, revision), params.aliases, production))
          found.add(one.path);
      return [...found];
    };

  const batched = (world: World, revision: string): World => {
    const texts = new Map<string, string | undefined>();
    return {
      ...world,
      prefetch: (wanted) => {
        const need = [...new Set(wanted)].filter((path) => !texts.has(path));
        if (need.length === 0) return;
        const blobs = blobsAt(root, revision, need);
        const loaded = blobTexts(root, [...new Set(blobs.values())]);
        for (const path of need) texts.set(path, blobs.has(path) ? loaded.get(blobs.get(path)!) : undefined);
      },
      read: (path) => (texts.has(path) ? texts.get(path) : world.read(path)),
    };
  };

  const whole = (commit: string): readonly Finding[] => {
    prepare(root, commit, null);
    const packages = manifestsAt(root, commit);
    const view = snapshot(side(commit, true), ['']);
    const analysis = callAnalysis(worldOf(view, { packages, aliases: params.aliases }), params, undefined, importersAcross(commit));
    seededMap(
      root,
      family,
      commit,
      analysis.carriers.map((path) => [`k:${path}`, 1] as const),
    );
    return sorted(analysis.findings);
  };

  const advance = (
    commit: string,
    source: { readonly revision: string; readonly id: string },
    changes: readonly TreeDifference[],
  ): Advance => {
    prepare(root, commit, source.revision);
    const standing = carriersAt(source.id);
    const universe = (path: string): boolean => production(path) && (inRegion(path, params) || within(path, 'packages'));
    const touched = changes.filter((change) => universe(change.path));
    const before = manifestsAt(root, source.revision);
    const after = manifestsAt(root, commit);
    const moved = movedPackages(root, source.revision, commit, changes);
    if (touched.length === 0 && moved.before.length === 0 && moved.after.length === 0 && !changes.some((change) => isManifest(change.path)))
      return {
        id: derivedMap(root, family, commit, source.id, new Map()),
        affected: new Set(),
        before: undefined,
        after: undefined,
        relevant: standing,
      };
    const names = [...new Set([...moved.before, ...moved.after].map((entry) => entry.name))];
    const seeds = new Set(touched.map((change) => change.path));
    if (names.length > 0)
      for (const at of new Set([source.revision, commit]))
        for (const entry of importersByName(root, at, names, universe)) seeds.add(entry.path);
    const forced = new Set(touched.filter((change) => change.before === null || change.after === null).map((change) => change.path));
    const view = (at: string, existing: (change: TreeDifference) => boolean) => {
      const scope = [...new Set([...seeds, ...touched.filter(existing).map((change) => change.path)])];
      return snapshot(side(at, false, scope), scope.length === 0 ? ['package.json'] : scope);
    };
    const beforeWorld = batched(
      worldOf(
        view(source.revision, (change) => change.before !== null),
        { packages: before, aliases: params.aliases },
      ),
      source.revision,
    );
    const afterWorld = batched(
      worldOf(
        view(commit, (change) => change.after !== null),
        { packages: after, aliases: params.aliases },
      ),
      commit,
    );
    const affected = new Set(
      callFrontier(beforeWorld, afterWorld, params, [...seeds], importersAcross(source.revision, commit), forced, standing),
    );
    const relevant: Carriers = { has: (path) => affected.has(path) || standing.has(path) };
    const existing = [...affected].filter((path) => afterWorld.read(path) !== undefined);
    const bearing = new Set(carrying(afterWorld, params, existing, relevant));
    const rows = new Map<string, unknown>();
    for (const path of affected) rows.set(`k:${path}`, bearing.has(path) ? 1 : undefined);
    return { id: derivedMap(root, family, commit, source.id, rows), affected, before: beforeWorld, after: afterWorld, relevant };
  };

  const stateOf = (commit: string): string => {
    const known = rootAt(root, family, commit);
    if (known !== undefined) return known;
    let best: { readonly revision: string; readonly id: string; readonly changes: readonly TreeDifference[] } | undefined;
    for (const one of recentRoots(root, family, NEARBY)) {
      const changes = changesBetween(root, one.revision, commit);
      if (best === undefined || changes.length < best.changes.length) best = { revision: one.revision, id: one.id, changes };
      if (changes.length < GOOD_ENOUGH) break;
    }
    if (best === undefined || best.changes.length > FAR)
      throw new NeedsPreparation(
        `no ask-calls state within ${FAR} changed files of ${commit}; run check_rules with inspection ask-calls over "change", using the same paths, whole and taking selection, to prepare the candidate before judging it again`,
      );
    return advance(commit, best, best.changes).id;
  };

  const affected = (
    base: string,
    tree: string,
  ): { readonly paths: ReadonlySet<string>; readonly base: readonly Finding[]; readonly tree: readonly Finding[] } => {
    const baseId = stateOf(base);
    const moved = advance(tree, { revision: base, id: baseId }, changesBetween(root, base, tree));
    const findingsOf = (world: World | undefined): readonly Finding[] => {
      if (world === undefined) return [];
      const judged = [...moved.affected].filter((path) => world.read(path) !== undefined && inRegion(path, params));
      return sorted(callAnalysis({ ...world, paths: judged }, params, judged, undefined, moved.relevant).findings);
    };
    return { paths: moved.affected, base: findingsOf(moved.before), tree: findingsOf(moved.after) };
  };

  return { whole, affected };
};

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Finding, Side } from '@runlith/tagma/rules';
import { changesBetween, FAR, GOOD_ENOUGH, importersOf, manifestsAt, prepare } from '../declarations/index';
import { listedAt } from '../directories';
import { blobTexts } from '../git';
import { derivedMap, recentRoots, rootAt, seededMap, valueAt } from '../maps';
import { versionAt } from './cache';
import { applyContributions, type Contribution, contributions, couplingFindings, indexCoupling, measuresOf, type Totals } from './coupling';
import type { CouplingParams } from './inspections';
import { type Module, moduleAt, moduleOwners, production, type snapshots, within } from './snapshot';

const NEARBY = 6;

type Territory = readonly (readonly [card: string, id: string])[];
type Owner = (path: string) => { readonly id: string } | undefined;

const source = (path: string): boolean =>
  production(path) && (within(path, 'apps/tagma/server/src') || within(path, 'apps/tagma/app/src') || within(path, 'packages'));
const manifest = (path: string): boolean => posix.basename(path) === 'package.json';
const cardOf = (path: string): boolean => path.startsWith('.tagma/') && path.endsWith('.md');
const moduleShape = (module: Module | undefined): string =>
  JSON.stringify(module === undefined ? null : { id: module.id, paths: module.paths });
const refOf = (ref: string): string => ref.replace(/\/$/, '');
const territoryKeys = (module: Module): string[] =>
  module.paths.map((one) => (one.kind === 'file' ? `tf:${refOf(one.ref)}` : `td:${refOf(one.ref)}`));

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const sideOf = (commit: string, paths: readonly string[]): Side => ({ commit, whole: false, paths, read: async () => null, facts: null });

const cloneOf = (totals: Totals): Totals => ({
  ...totals,
  targets: Object.assign(Object.create(null) as Record<string, number>, totals.targets),
});

export type CouplingJudge = {
  readonly whole: (tree: Side, base: Side | null) => { readonly tree: readonly Finding[]; readonly base: readonly Finding[] | undefined };
  readonly affected: (
    base: Side,
    tree: Side,
  ) => { readonly paths: ReadonlySet<string>; readonly base: readonly Finding[]; readonly tree: readonly Finding[] };
};

export const couplingJudge = (
  root: string,
  revision: string,
  params: CouplingParams,
  snapshot: ReturnType<typeof snapshots>,
): CouplingJudge => {
  const signature = createHash('sha256').update(JSON.stringify(params.aliases)).digest('hex');
  const family = `coupling:${versionAt(root, revision)}:${signature}`;

  const ownerOver = (rootId: string, overlay: ReadonlyMap<string, unknown>): Owner => {
    const looked = (key: string): unknown => (overlay.has(key) ? overlay.get(key) : valueAt(root, rootId, key));
    const pick = (key: string): string | undefined => {
      const held = looked(key) as Territory | undefined;
      return held === undefined || held.length === 0 ? undefined : held[held.length - 1]![1];
    };
    const memo = new Map<string, { readonly id: string } | undefined>();
    return (path) => {
      if (memo.has(path)) return memo.get(path);
      let id = pick(`tf:${path}`);
      for (let at = path; id === undefined && at !== '.'; at = posix.dirname(at)) id = pick(`td:${at}`);
      id ??= pick('td:.');
      const found = id === undefined ? undefined : { id };
      memo.set(path, found);
      return found;
    };
  };

  const seed = (commit: string, modules: readonly Module[], totals: Readonly<Record<string, Totals>>): void => {
    const territories = new Map<string, [string, string][]>();
    for (const module of modules)
      for (const key of territoryKeys(module)) {
        const held = territories.get(key);
        if (held === undefined) territories.set(key, [[module.card ?? '', module.id]]);
        else held.push([module.card ?? '', module.id]);
      }
    const sharing = new Map<string, string[]>();
    for (const [id, one] of Object.entries(totals)) {
      const held = sharing.get(one.path);
      if (held === undefined) sharing.set(one.path, [id]);
      else held.push(id);
    }
    seededMap(root, family, commit, [
      ...Object.entries(totals).map(([id, one]) => [`m:${id}`, one] as const),
      ...[...sharing].map(([path, ids]) => [`r:${path}`, ids.sort(byText)] as const),
      ...modules.flatMap((module) => (module.card === undefined ? [] : [[`c:${module.card}`, module] as const])),
      ...[...territories].map(([key, held]) => [key, held.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))] as const),
    ]);
  };

  const place = (
    findings: readonly Finding[],
    tree: Side,
    owners: readonly Owner[],
    cards: ReadonlyMap<string, string>,
    only?: ReadonlySet<string>,
  ): readonly Finding[] => {
    const paths = new Map<string, string>();
    const metadata = tree.paths.find((path) => path === 'package.json' || path.endsWith('/package.json') || path.startsWith('.tagma/'));
    for (const path of tree.paths) {
      for (const owner of owners) {
        const module = owner(path);
        if (module !== undefined && !paths.has(module.id)) paths.set(module.id, path);
      }
      const id = cards.get(path);
      if (id !== undefined) paths.set(id, path);
    }
    return findings.map((one) => {
      if (!/:(?:modules|share)-(?:increase|ceiling)$/.test(one.fingerprint)) return one;
      const id = one.fingerprint.slice('coupling:'.length, one.fingerprint.lastIndexOf(':'));
      if (only !== undefined && !only.has(id)) return one;
      const path = paths.get(id) ?? metadata;
      return path === undefined ? one : { ...one, path };
    });
  };

  const whole: CouplingJudge['whole'] = (tree, base) => {
    const measure = (side: Side) => {
      prepare(root, side.commit, null);
      const index = indexCoupling(snapshot(side, ['']), side.commit, params.aliases);
      seed(side.commit, index.modules, index.totals);
      return index;
    };
    const now = measure(tree);
    const prior = base === null ? null : measure(base);
    const was = prior === null ? null : measuresOf(prior.totals);
    const cards = new Map(
      [...(prior?.modules ?? []), ...now.modules].filter((one) => one.card !== undefined).map((one) => [one.card!, one.id]),
    );
    return {
      tree: place(
        couplingFindings(measuresOf(now.totals), params, was),
        tree,
        [moduleOwners(now.modules), moduleOwners(prior?.modules ?? [])],
        cards,
      ),
      base: was === null ? undefined : couplingFindings(was, params, null),
    };
  };

  type Derived = {
    readonly id: string;
    readonly touched: ReadonlySet<string>;
    readonly before: (id: string) => Totals | undefined;
    readonly after: (id: string) => Totals | undefined;
    readonly ownerBefore: Owner;
    readonly ownerAfter: Owner;
    readonly cards: ReadonlyMap<string, string>;
  };

  const derive = (
    target: Side,
    from: { readonly revision: string; readonly id: string },
    changes: ReturnType<typeof changesBetween>,
  ): Derived => {
    prepare(root, target.commit, from.revision);
    const was = manifestsAt(root, from.revision);
    const now = manifestsAt(root, target.commit);
    const metadata = changes.filter((one) => manifest(one.path) || cardOf(one.path));
    const texts = blobTexts(root, [...new Set(metadata.flatMap((one) => (cardOf(one.path) && one.after !== null ? [one.after] : [])))]);
    const overlay = new Map<string, unknown>();
    const changedTerritories = new Set<string>();
    const changedPackages = new Set<string>();
    const touched = new Set<string>();
    const cards = new Map<string, string>();
    for (const change of metadata) {
      if (manifest(change.path)) {
        const directory = posix.dirname(change.path) === '.' ? '' : posix.dirname(change.path);
        if (JSON.stringify(was.at(directory)) !== JSON.stringify(now.at(directory))) changedPackages.add(directory);
        continue;
      }
      const before = valueAt(root, from.id, `c:${change.path}`) as Module | undefined;
      const after = change.after === null ? undefined : moduleAt(change.path, texts.get(change.after)!);
      if (before === undefined && after === undefined) continue;
      overlay.set(`c:${change.path}`, after);
      const id = after?.id ?? before?.id;
      if (id !== undefined) cards.set(change.path, id);
      for (const module of [before, after]) if (module !== undefined) touched.add(module.id);
      for (const [module, add] of [
        [before, false],
        [after, true],
      ] as const)
        if (module !== undefined)
          for (const key of territoryKeys(module)) {
            const held = ((overlay.has(key) ? overlay.get(key) : valueAt(root, from.id, key)) as Territory | undefined) ?? [];
            const next = held.filter((one) => one[0] !== change.path);
            if (add) next.push([change.path, module.id]);
            overlay.set(key, next.length === 0 ? undefined : [...next].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
          }
      if (moduleShape(before) !== moduleShape(after))
        for (const module of [before, after]) for (const one of module?.paths ?? []) changedTerritories.add(one.ref);
    }
    const ownerBefore = ownerOver(from.id, new Map());
    const ownerAfter = ownerOver(from.id, overlay);
    const affected = new Set(changes.map((one) => one.path).filter(source));
    const targets = new Set(
      changes.filter((one) => source(one.path) && (one.before === null || one.after === null)).map((one) => one.path),
    );
    const roots = [...changedTerritories, ...changedPackages];
    for (const commit of [from.revision, target.commit]) {
      if (roots.length === 0) break;
      for (const path of [...listedAt(root, commit, roots, true).keys()].filter(source)) {
        targets.add(path);
        if ([...changedTerritories].some((one) => within(path, one))) affected.add(path);
      }
    }
    if (targets.size > 0)
      for (const [commit, members] of [
        [from.revision, was],
        [target.commit, now],
      ] as const)
        for (const importer of importersOf(root, commit, targets, members, params.aliases, source)) affected.add(importer.path);
    const local: Record<string, Totals> = Object.create(null);
    const original = new Map<string, Totals | undefined>();
    const loaded = (id: string): void => {
      if (original.has(id)) return;
      const held = valueAt(root, from.id, `m:${id}`) as Totals | undefined;
      original.set(id, held);
      if (held !== undefined) local[id] = cloneOf(held);
    };
    if (affected.size > 0) {
      const paths = [...affected];
      const scope = (commit: string) => snapshot({ ...target, commit, paths, whole: false }, undefined);
      const leaving: readonly Contribution[] = contributions(scope(from.revision), ownerBefore, was, params.aliases);
      const arriving: readonly Contribution[] = contributions(scope(target.commit), ownerAfter, now, params.aliases);
      for (const entry of [...leaving, ...arriving]) loaded(entry.module);
      applyContributions(local, leaving, -1);
      applyContributions(local, arriving, 1);
      const moves = new Map<string, { readonly out: Set<string>; readonly in: Set<string> }>();
      const slot = (path: string) => {
        const held = moves.get(path) ?? { out: new Set<string>(), in: new Set<string>() };
        moves.set(path, held);
        return held;
      };
      for (const [id, held] of original) {
        overlay.set(`m:${id}`, local[id]);
        touched.add(id);
        if (held !== undefined) slot(held.path).out.add(id);
        if (local[id] !== undefined) slot(local[id]!.path).in.add(id);
      }
      for (const [path, move] of moves) {
        const standing = (valueAt(root, from.id, `r:${path}`) as readonly string[] | undefined) ?? [];
        const ids = new Set(standing.filter((one) => !move.out.has(one)));
        for (const one of move.in) ids.add(one);
        overlay.set(`r:${path}`, ids.size === 0 ? undefined : [...ids].sort(byText));
      }
    }
    for (const path of affected)
      for (const owner of [ownerBefore, ownerAfter]) {
        const module = owner(path);
        if (module !== undefined) touched.add(module.id);
      }
    const id = derivedMap(root, family, target.commit, from.id, overlay);
    return {
      id,
      touched,
      before: (one) => {
        loaded(one);
        return original.get(one);
      },
      after: (one) => (overlay.has(`m:${one}`) ? (overlay.get(`m:${one}`) as Totals | undefined) : (loaded(one), original.get(one))),
      ownerBefore,
      ownerAfter,
      cards,
    };
  };

  const stateOf = (side: Side): string => {
    const known = rootAt(root, family, side.commit);
    if (known !== undefined) return known;
    let best: { readonly revision: string; readonly id: string; readonly changes: ReturnType<typeof changesBetween> } | undefined;
    for (const one of recentRoots(root, family, NEARBY)) {
      const changes = changesBetween(root, one.revision, side.commit);
      if (best === undefined || changes.length < best.changes.length) best = { revision: one.revision, id: one.id, changes };
      if (changes.length < GOOD_ENOUGH) break;
    }
    if (best === undefined || best.changes.length > FAR)
      throw new Error(
        'coupling has no revision index; run check_rules over all with inspection coupling to remeasure before judging a change',
      );
    return derive(
      sideOf(
        side.commit,
        best.changes.map((one) => one.path),
      ),
      best,
      best.changes,
    ).id;
  };

  const affected: CouplingJudge['affected'] = (base, tree) => {
    prepare(root, tree.commit, base.commit);
    const baseId = stateOf(base);
    const out = derive(tree, { revision: base.commit, id: baseId }, changesBetween(root, base.commit, tree.commit));
    const touched = new Set(out.touched);
    for (const path of [...tree.paths, ...base.paths])
      for (const owner of [out.ownerBefore, out.ownerAfter]) {
        const module = owner(path);
        if (module !== undefined) touched.add(module.id);
      }
    const judge = (judged: ReadonlySet<string>) => {
      const totalsOf = (pick: (id: string) => Totals | undefined): Record<string, Totals> =>
        Object.fromEntries(
          [...judged].flatMap((id) => {
            const held = pick(id);
            return held === undefined ? [] : [[id, held] as const];
          }),
        );
      const was = measuresOf(totalsOf(out.before));
      const found = place(
        couplingFindings(measuresOf(totalsOf(out.after)), params, was),
        tree,
        [out.ownerAfter, out.ownerBefore],
        out.cards,
        touched,
      );
      return { base: couplingFindings(was, params, null), tree: found };
    };
    const first = judge(touched);
    const covered = new Set([...first.tree, ...first.base].map((one) => one.path));
    const sharing = new Set<string>();
    for (const path of new Set([...covered, ...tree.paths, ...base.paths]))
      for (const id of (valueAt(root, baseId, `r:${path}`) as readonly string[] | undefined) ?? []) if (!touched.has(id)) sharing.add(id);
    const found = sharing.size === 0 ? first : judge(new Set([...touched, ...sharing]));
    return { paths: new Set([...found.tree, ...found.base].map((one) => one.path)), base: found.base, tree: found.tree };
  };

  return { whole, affected };
};

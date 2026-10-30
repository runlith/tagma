import type { Finding, Side } from '@runlith/tagma/rules';
import { changesBetween, FAR, GOOD_ENOUGH, prepare } from '../declarations/index';
import { derivedMap, recentRoots, rootAt, seededMap, valueAt } from '../maps';
import { versionAt } from './cache';
import type { VendorParams } from './inspections';
import { indexLiterals, literalCandidates } from './literals';
import { production, selectSources, type Snapshot, type snapshots, within } from './snapshot';
import { indexedWords, isVendorSource, listedWords, vendorFindings, vendorWords, type VendorWords } from './strings';

const NEARBY = 6;
const WHOLE_SCOPE = ['packages', 'apps/tagma/server/src/external-harnesses/vendors'];

const declares = (path: string): boolean =>
  production(path) && (/^packages\/adapter-[^/]+\//.test(path) || within(path, 'apps/tagma/server/src/external-harnesses/vendors'));

const ordered = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.fingerprint.localeCompare(b.fingerprint));

const longestFirst = (words: Iterable<string>): string[] => [...new Set(words)].sort((a, b) => b.length - a.length || a.localeCompare(b));

const sideOf = (commit: string, paths: readonly string[]): Side => ({ commit, whole: false, paths, read: async () => null, facts: null });

export type VendorJudge = {
  readonly whole: (side: Side) => readonly Finding[];
  readonly affected: (
    base: Side,
    tree: Side,
  ) => { readonly paths: ReadonlySet<string>; readonly base: readonly Finding[]; readonly tree: readonly Finding[] };
};

export const vendorJudge = (root: string, revision: string, params: VendorParams, snapshot: ReturnType<typeof snapshots>): VendorJudge => {
  const version = versionAt(root, revision);
  const family = `vendor-words:${version}`;
  const eligible = (path: string): boolean => production(path) && isVendorSource(path, params);

  const scanning = (snapshot: Snapshot, words: VendorWords): readonly Finding[] =>
    snapshot.paths.flatMap((path) => {
      const file = selectSources(snapshot, [path]);
      indexLiterals(root, version, file, params);
      return vendorFindings(file, params, words);
    });

  const scan = (side: Side, paths: readonly string[], words: VendorWords): readonly Finding[] =>
    paths.length === 0 ? [] : scanning(snapshot({ ...side, paths, whole: false }), words);

  const declaredAt = (id: string): VendorWords => indexedWords((word) => valueAt(root, id, `w:${word}`) !== undefined);

  const derived = (commit: string, sourceRoot: string, changes: readonly { readonly path: string }[]): string => {
    const declaring = changes.map((one) => one.path).filter(declares);
    const sources = changes.map((one) => one.path).filter(eligible);
    const rows = new Map<string, unknown>();
    const held = (key: string): readonly string[] =>
      ((rows.has(key) ? rows.get(key) : valueAt(root, sourceRoot, key)) as readonly string[] | undefined) ?? [];
    if (declaring.length + sources.length > 0) {
      const changed = snapshot(sideOf(commit, [...new Set([...declaring, ...sources])]));
      for (const path of changed.paths) indexLiterals(root, version, selectSources(changed, [path]), params);
      const present = new Set(changed.paths);
      for (const path of declaring) {
        const was = held(`p:${path}`);
        const now = present.has(path) ? vendorWords(selectSources(changed, [path])) : [];
        if (was.length === now.length && was.every((one, at) => one === now[at])) continue;
        rows.set(`p:${path}`, now.length === 0 ? undefined : now);
        for (const word of was)
          if (!now.includes(word)) {
            const left = held(`w:${word}`).filter((one) => one !== path);
            rows.set(`w:${word}`, left.length === 0 ? undefined : left);
          }
        for (const word of now) if (!was.includes(word)) rows.set(`w:${word}`, [...held(`w:${word}`), path].sort());
      }
    }
    return derivedMap(root, family, commit, sourceRoot, rows);
  };

  const declared = (commit: string, hint: string | null): string => {
    const known = rootAt(root, family, commit);
    if (known !== undefined) return known;
    let best: { readonly source: string; readonly id: string; readonly changes: ReturnType<typeof changesBetween> } | undefined;
    const sources = [
      ...(hint === null ? [] : [{ revision: hint, id: rootAt(root, family, hint) }]),
      ...recentRoots(root, family, NEARBY).map((one) => ({ revision: one.revision, id: one.id as string | undefined })),
    ].filter((one): one is { revision: string; id: string } => one.id !== undefined);
    for (const one of sources) {
      const changes = changesBetween(root, one.revision, commit);
      if (best === undefined || changes.length < best.changes.length) best = { source: one.revision, id: one.id, changes };
      if (changes.length < GOOD_ENOUGH) break;
    }
    if (best === undefined || best.changes.length > FAR)
      throw new Error(
        'vendor-ids has no revision index; run check_rules over all with inspection vendor-ids to remeasure before judging a change',
      );
    return derived(commit, best.id, best.changes);
  };

  const whole = (side: Side): readonly Finding[] => {
    prepare(root, side.commit, null);
    const view = snapshot(side, WHOLE_SCOPE);
    const origins = new Map<string, readonly string[]>();
    for (const path of view.paths.filter(declares)) {
      const found = vendorWords(selectSources(view, [path]));
      if (found.length > 0) origins.set(path, found);
    }
    const declaring = new Map<string, string[]>();
    for (const [path, found] of origins) for (const word of found) declaring.set(word, [...(declaring.get(word) ?? []), path]);
    const words = longestFirst(declaring.keys());
    seededMap(root, family, side.commit, [
      ...[...origins].map(([path, found]) => [`p:${path}`, found] as const),
      ...[...declaring].map(([word, paths]) => [`w:${word}`, paths.sort()] as const),
    ]);
    return ordered(scanning(snapshot(side, [params.source]), listedWords(words)));
  };

  const affected: VendorJudge['affected'] = (base, tree) => {
    prepare(root, tree.commit, base.commit);
    const baseRoot = declared(base.commit, null);
    const changes = changesBetween(root, base.commit, tree.commit);
    const treeRoot = rootAt(root, family, tree.commit) ?? derived(tree.commit, baseRoot, changes);
    const before = declaredAt(baseRoot);
    const now = declaredAt(treeRoot);
    const named = new Set<string>();
    for (const path of changes.map((one) => one.path).filter(declares))
      for (const id of [baseRoot, treeRoot])
        for (const word of (valueAt(root, id, `p:${path}`) as readonly string[] | undefined) ?? []) named.add(word);
    const held = (id: string, word: string): boolean => valueAt(root, id, `w:${word}`) !== undefined;
    const words = [...named];
    const paths = new Set(changes.map((one) => one.path).filter(eligible));
    for (const path of literalCandidates(
      root,
      version,
      tree.commit,
      words.filter((word) => held(treeRoot, word) && !held(baseRoot, word)),
    ))
      if (eligible(path)) paths.add(path);
    for (const path of literalCandidates(
      root,
      version,
      base.commit,
      words.filter((word) => held(baseRoot, word) && !held(treeRoot, word)),
    ))
      if (eligible(path)) paths.add(path);
    return { paths, base: ordered(scan(base, [...paths], before)), tree: ordered(scan(tree, [...paths], now)) };
  };

  return { whole, affected };
};

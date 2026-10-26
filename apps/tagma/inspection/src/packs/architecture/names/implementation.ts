import type { Adapters } from '@runlith/code-facts/adapter';
import { OUTLINE, type Outline } from '@runlith/code-facts/js';
import { facetOf, type Tree } from '@runlith/code-facts/tree';
import type { Budget } from '../../../core/node/budget';
import type { Implementation } from '../../../core/node/reading';
import { localOf, picks } from '../../../core/node/select';
import { bare } from '../../../core/params';
import type { Unjudged, Violation } from '../../../core/verdict';
import { literalSignals } from './literals';
import { directorySignals, fileSignals } from './paths';
import type { NameParams, Reading, Seat } from './reading';
import { serviceKeys, symbolSignals, typedNames, typeSignals } from './symbols';
import { lastOf } from './words';

const inside = (entry: string, local: string): boolean => {
  const at = bare(entry);
  return at === '' || local === at || local.startsWith(`${at}/`);
};

const selects = (params: NameParams, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && picks(params.files, local) && !params.uncovered.some(({ path: entry }) => inside(entry, path));
};

const seats = (params: NameParams): ((path: string) => Seat) => {
  const entries = params.modules
    .flatMap(({ id, territory }) => territory.map((entry) => ({ at: bare(entry), id })))
    .sort((left, right) => right.at.length - left.at.length);
  const homes = new Map(
    params.modules.flatMap(({ id, territory }) =>
      territory
        .map(bare)
        .filter((at) => lastOf(at) === id)
        .map((at) => [id, at] as const),
    ),
  );
  const held = new Map<string, Seat>();
  return (path) => {
    const known = held.get(path);
    if (known !== undefined) return known;
    const local = localOf(params.base, path) ?? path;
    const owner = entries.find(({ at }) => inside(at, local));
    const slash = local.indexOf('/');
    const first = slash === -1 ? '' : local.slice(0, slash);
    const module = owner?.id ?? (first === '' ? lastOf(params.base) : first);
    const seat: Seat = { path, local, module, home: owner === undefined ? (first === '' ? undefined : first) : homes.get(owner.id) };
    held.set(path, seat);
    return seat;
  };
};

const WORD = /^[A-Za-z_$][\w$]*$/;

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const readNames = (
  params: NameParams,
  tree: Tree,
  paths: readonly string[],
  adapters: Adapters,
  budget: Budget,
): { readonly violations: readonly Violation[]; readonly unjudged: readonly Unjudged[] } => {
  const held = new Map<string, Outline>();
  const selected = [...new Set(paths.filter((path) => selects(params, path)))].sort();
  const reading = new Set(selected);
  let listing: readonly string[] | undefined | null = null;
  const listed = (): readonly string[] | undefined => {
    if (listing === null) listing = tree.paths === undefined ? undefined : [...tree.paths()].filter((path) => selects(params, path));
    return listing;
  };
  const facts = (path: string): Outline => {
    const known = held.get(path);
    if (known !== undefined) return known;
    budget.take(1, tree.size?.(path) ?? 0);
    const found = facetOf(tree, path, OUTLINE, adapters);
    held.set(path, found);
    return found;
  };
  let complete: boolean | null = null;
  const whole = (): boolean => (complete ??= (listed() ?? []).every((path) => reading.has(path)));
  const mentions = new Map<string, readonly string[]>();
  const mentioning = (text: string): readonly string[] => {
    const known = mentions.get(text);
    if (known !== undefined) return known;
    const everything = listed() ?? [];
    const asked = tree.mentions?.([text]);
    const token = WORD.test(text) ? new RegExp(`(?:^|[^\\w$])${escaped(text)}(?![\\w$])`) : undefined;
    const found =
      asked !== undefined
        ? [...asked].filter((path) => selects(params, path))
        : tree.mentions !== undefined
          ? []
          : everything.filter((path) => {
              const written = tree.read(path);
              return token === undefined ? written.includes(text) : token.test(written);
            });
    if (asked !== undefined || tree.mentions === undefined) mentions.set(text, found);
    return found;
  };
  let typeIndex: Map<string, string[]> | undefined;
  let keyIndex: Map<string, string[]> | undefined;
  const indexed = (build: (path: string) => Iterable<string>): Map<string, string[]> => {
    const index = new Map<string, string[]>();
    for (const path of listed() ?? []) {
      for (const key of build(path)) {
        const at = index.get(key);
        if (at === undefined) index.set(key, [path]);
        else at.push(path);
      }
    }
    return index;
  };
  const state: Reading = {
    params,
    seat: seats(params),
    facts,
    listed,
    declaring: (name) => {
      if (whole()) return (typeIndex ??= indexed((path) => typedNames(facts(path)))).get(name) ?? [];
      return mentioning(name).filter((path) => typedNames(facts(path)).has(name));
    },
    keying: (id) => {
      if (whole())
        return (keyIndex ??= indexed((path) => serviceKeys(facts(path), params.services).map((key) => key.tag as string))).get(id) ?? [];
      return mentioning(id).filter((path) => serviceKeys(facts(path), params.services).some((key) => key.tag === id));
    },
    found: [],
    unjudged: [],
  };
  for (const path of selected) {
    fileSignals(state, path);
    symbolSignals(state, path);
    literalSignals(state, path);
  }
  directorySignals(state, selected);
  typeSignals(state, selected);
  const seen = new Set<string>();
  const violations = state.found.filter(({ fingerprint, file }) => {
    const key = `${fingerprint}\0${file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { violations, unjudged: state.unjudged };
};

export const names: Implementation<NameParams> = {
  facet: OUTLINE,
  lists: (params) => [params.base],
  selects,
  read: readNames,
};

import type { Adapters } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import { resolveRelative } from '@runlith/code-facts/js/resolve';
import type { Violation } from '@tagma/inspection/verdict';
import type { Budget } from '@tagma/inspection/node/budget';
import { type Checked, checkedOnce, type InspectionMemo, objectsOf, validMemo } from '@tagma/inspection/node/memo';
import type { Implementation, ReadingScope } from '@tagma/inspection/node/reading';
import { bare, inRegion } from '../params';
import { localOf, mentionedIn, picks } from '../select';
import { FORMS, type EffectStyleParams } from './declaration';
import { type Site, type Source, referenceIn, sitesIn, sourceIn } from './sites';

const selects = (params: EffectStyleParams, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && inRegion(params, path) && picks(params.files, local);
};

const LINE = /^(\d+) (\S+) (\S+) ([0-9a-f]{8})$/;
const WORDS = [
  'self',
  'implements',
  'gen',
  'fn',
  'throw',
  'decode',
  'runSync',
  'TaggedError',
  'runPromise',
  'make',
  '_tag',
  'Context',
  'Layer',
  '\\u',
];
const MESSAGES: Readonly<Record<Site['form'], string>> = {
  'self-alias': '`const self = this` aliases a class receiver',
  'self-binding': 'an Effect generator binds a `self` receiver',
  'service-class': 'a class implements a service shape',
  'service-instance': 'a class instance is provided as a service implementation',
  'gen-wrapper': 'a reusable function wraps `Effect.gen`',
  'pipe-after-fn': 'an Effect function has trailing behaviour in `.pipe`',
  'throw-in-effect': 'an Effect generator throws synchronously',
  'sync-decode-in-effect': 'an Effect generator decodes synchronously',
  'clock-bypass': 'an Effect generator or its sync callback reads time or waits outside `Clock` and `Effect.sleep`',
  'scope-run-sync': '`Effect.runSync` opens a scope',
  'schema-tagged-error': 'an error class extends `Schema.TaggedError`',
  'native-tagged-error': 'an error class extends a native error with a handwritten `_tag`',
  'test-runner': 'a test starts an Effect runner or managed runtime',
};

const unpacked = (held: readonly Violation[]): readonly Site[] | undefined => {
  const sites: Site[] = [];
  for (const one of held) {
    const match = LINE.exec(one.fingerprint);
    if (match === null || !(FORMS as readonly string[]).includes(match[3]!)) return undefined;
    sites.push({ line: Number(match[1]), symbol: match[2]!, form: match[3] as Site['form'], site: match[4]! });
  }
  return sites;
};

type ParsedSource = { readonly text: string; readonly source: Source };
const sitesOf = (
  tree: Tree,
  path: string,
  memo: InspectionMemo | undefined,
  checked: Checked,
  sources: Map<string, ParsedSource>,
): readonly Site[] => {
  const key = `effect-style/bound-sites-v2\0${path}`;
  if (memo !== undefined && validMemo(key, objectsOf(tree), () => '', memo, checked)) {
    const held = memo.get(key);
    const sites = held === undefined ? undefined : unpacked(held.violations);
    if (sites !== undefined) return sites;
  }
  const dependencies = new Map<string, string | null>();
  const note = (path: string): void => {
    dependencies.set(path, tree.object?.(path) ?? null);
  };
  const sourceAt = (path: string): ParsedSource => {
    note(path);
    let held = sources.get(path);
    if (held === undefined) {
      const text = tree.read(path);
      held = { text, source: sourceIn(path, text) };
      sources.set(path, held);
    }
    return held;
  };
  const traced: Tree = {
    ...tree,
    has: (path) => {
      const found = tree.has(path);
      note(path);
      return found;
    },
  };
  const resolving = new Set<string>();
  const references = new Map<string, boolean>();
  const importedFrom =
    (from: string) =>
    (specifier: string, name: string): boolean => {
      if (!specifier.startsWith('.')) return false;
      const target = resolveRelative(specifier, from, traced);
      if (target === null) return false;
      const key = `${target}\0${name}`;
      const held = references.get(key);
      if (held !== undefined) return held;
      if (resolving.has(key)) return false;
      resolving.add(key);
      const found = referenceIn(sourceAt(target).source, name, importedFrom(target));
      resolving.delete(key);
      references.set(key, found);
      return found;
    };
  const parsed = sourceAt(path);
  const sites = sitesIn(path, parsed.text, parsed.source, importedFrom(path));
  if (memo !== undefined && tree.object !== undefined) {
    memo.set(key, {
      dependencies: [...dependencies],
      listings: [],
      violations: sites.map((one) => ({ fingerprint: `${one.line} ${one.symbol} ${one.form} ${one.site}`, file: '', line: one.line })),
      read: [],
    });
  }
  return sites;
};

const read = (
  params: EffectStyleParams,
  tree: Tree,
  paths: readonly string[],
  _adapters: Adapters,
  budget: Budget,
  memo?: InspectionMemo,
  scope: ReadingScope = 'reach',
) => {
  const forms = new Set(params.forms);
  const selected = [...new Set(paths)].filter((path) => tree.has(path) && selects(params, path)).sort();
  const mentioned = mentionedIn(tree, selected, WORDS, scope);
  const touched = mentioned === undefined ? selected : selected.filter((path) => mentioned.has(path));
  const checked = checkedOnce();
  const sources = new Map<string, ParsedSource>();
  const violations: Violation[] = [];
  for (const path of touched) {
    budget.take(1, tree.size?.(path) ?? 0);
    const local = localOf(params.base, path) ?? path;
    const seen = new Map<string, number>();
    for (const site of sitesOf(tree, path, memo, checked, sources)) {
      if (!forms.has(site.form)) continue;
      const named = `${local} ${site.symbol} ${site.form} ${site.site}`;
      const count = (seen.get(named) ?? 0) + 1;
      seen.set(named, count);
      violations.push({
        fingerprint: count === 1 ? named : `${named}#${count}`,
        file: path,
        line: site.line,
        specifier: site.form,
        message: `${MESSAGES[site.form]} (site ${site.site})`,
      });
    }
  }
  return { violations, unjudged: [] };
};

export const effectStyle: Implementation<EffectStyleParams> = {
  lists: (params) => params.region.map((one) => (params.base === '' ? bare(one) : `${params.base}/${bare(one)}`)),
  selects,
  read,
  prefetch: false,
};

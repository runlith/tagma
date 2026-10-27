import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
import { EditorSelection, type EditorState, Facet, type Range, RangeSet, StateField, type Text } from '@codemirror/state';
import { type Command, EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view';
import type { FindField, FindMatches, FindQuery } from '../marks';
import { Ink, inkOf, rulerSources } from './ruler';

const MATCH_CAP = 5_000;
const SEED_CAP = 100;
const MATCH = new Ink('var(--muted-foreground)');

type Found = { readonly query: SearchQuery | null; readonly set: RangeSet<Ink>; readonly end: number | null };

export type Finding = {
  readonly query: FindQuery;
  readonly matches: FindMatches | null;
  readonly invalid: boolean;
  readonly replaceable: boolean;
};

export type FindHooks = {
  opened: ((view: EditorView) => void) | undefined;
  moved: ((view: EditorView) => void) | undefined;
  closed: (() => void) | undefined;
  asked: ((field: FindField) => void) | undefined;
  cover: (() => number) | undefined;
};

export const findHooks = Facet.define<FindHooks, FindHooks | undefined>({ combine: (values) => values.at(-1) });

function scan(doc: Text, query: SearchQuery, from: number, to: number): Range<Ink>[] {
  const hits: Range<Ink>[] = [];
  const cursor = query.getCursor(doc, from, to);
  for (let next = cursor.next(); !next.done && hits.length < MATCH_CAP; next = cursor.next())
    hits.push(MATCH.range(next.value.from, next.value.to));
  return hits;
}

const searched = (state: EditorState): SearchQuery | null => {
  if (!searchPanelOpen(state)) return null;
  const query = getSearchQuery(state);
  return query.valid && query.search !== '' ? query : null;
};

const EMPTY: Found = { query: null, set: RangeSet.empty, end: null };

const sameSearch = (one: SearchQuery, other: SearchQuery): boolean =>
  one.search === other.search &&
  one.caseSensitive === other.caseSensitive &&
  one.wholeWord === other.wholeWord &&
  one.regexp === other.regexp &&
  one.literal === other.literal;

function scanned(doc: Text, query: SearchQuery): Found {
  const hits = scan(doc, query, 0, doc.length);
  return { query, set: RangeSet.of(hits), end: hits.length < MATCH_CAP ? null : (hits.at(-1)?.to ?? null) };
}

const matches = StateField.define<Found>({
  create: () => EMPTY,
  update(found, tr) {
    const query = searched(tr.state);
    if (query === null) return found.query === null ? found : EMPTY;
    const doc = tr.state.doc;
    if (found.query === null || !sameSearch(found.query, query)) return scanned(doc, query);
    if (!tr.docChanged) return found.query === query ? found : { ...found, query };
    const end = found.end === null ? null : tr.changes.mapPos(found.end);
    let set = found.set.map(tr.changes);
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = doc.lineAt(fromB).from;
      if (end !== null && from >= end) return;
      const to = end === null ? doc.lineAt(toB).to : Math.min(doc.lineAt(toB).to, end);
      set = set.update({ filter: () => false, filterFrom: from, filterTo: to, add: scan(doc, query, from, to) });
    });
    return { query, set, end };
  },
});

function counted(state: EditorState): FindMatches | null {
  const found = state.field(matches);
  if (found.query === null) return null;
  const { from, to } = state.selection.main;
  let current: number | null = null;
  let index = 0;
  for (const cursor = found.set.iter(); cursor.value !== null && cursor.from <= from; cursor.next()) {
    index += 1;
    if (cursor.from === from && cursor.to === to) {
      current = index;
      break;
    }
  }
  return { total: found.set.size, current, more: found.end !== null };
}

export function finding(state: EditorState): Finding {
  const spec = getSearchQuery(state);
  return {
    query: {
      search: spec.search,
      caseSensitive: spec.caseSensitive,
      wholeWord: spec.wholeWord,
      regexp: spec.regexp,
      replace: spec.replace,
    },
    matches: counted(state),
    invalid: spec.search !== '' && !spec.valid,
    replaceable: !state.readOnly,
  };
}

type Hit = { readonly from: number; readonly to: number };

function firstFrom(state: EditorState, query: SearchQuery, from: number): Hit | null {
  const after = query.getCursor(state, from).next();
  if (!after.done) return after.value;
  const before = query.getCursor(state, 0, from).next();
  return before.done ? null : before.value;
}

function nextFound(state: EditorState, query: SearchQuery, from: number): Hit | null {
  const found = state.field(matches);
  if (found.query === null) return firstFrom(state, query, from);
  for (const cursor = found.set.iter(from); cursor.value !== null; cursor.next())
    if (cursor.from >= from) return { from: cursor.from, to: cursor.to };
  if (found.end !== null) return firstFrom(state, query, from);
  const first = found.set.iter();
  return first.value === null ? null : { from: first.from, to: first.to };
}

export function seek(view: EditorView, patch: Partial<FindQuery>): void {
  const spec = getSearchQuery(view.state);
  const query = new SearchQuery({
    search: patch.search ?? spec.search,
    caseSensitive: patch.caseSensitive ?? spec.caseSensitive,
    wholeWord: patch.wholeWord ?? spec.wholeWord,
    regexp: patch.regexp ?? spec.regexp,
    replace: patch.replace ?? spec.replace,
    literal: spec.literal,
  });
  if (query.eq(spec)) return;
  view.dispatch({ effects: setSearchQuery.of(query) });
  if (sameSearch(query, spec) || !query.valid) return;
  const hit = nextFound(view.state, query, view.state.selection.main.from);
  if (hit === null) return;
  const selection = EditorSelection.single(hit.from, hit.to);
  view.dispatch({ selection, effects: EditorView.scrollIntoView(selection.main), userEvent: 'select.search' });
}

export function closeFind(view: EditorView): void {
  view.focus();
  closeSearchPanel(view);
}

export function selectFound(view: EditorView): void {
  if (selectMatches(view)) view.focus();
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function opener(field: FindField): Command {
  return (view) => {
    const state = view.state;
    const spec = getSearchQuery(state);
    const main = state.selection.main;
    const word = main.empty ? state.wordAt(main.head) : null;
    const seed = word ?? (!main.empty && main.to - main.from <= SEED_CAP && state.doc.lineAt(main.from).to >= main.to ? main : null);
    const text = seed === null ? null : state.sliceDoc(seed.from, seed.to);
    const query =
      text === null
        ? spec
        : new SearchQuery({
            search: spec.regexp ? escaped(text) : text,
            caseSensitive: spec.caseSensitive,
            wholeWord: spec.wholeWord,
            regexp: spec.regexp,
            replace: spec.replace,
            literal: spec.literal,
          });
    view.dispatch({ effects: setSearchQuery.of(query), selection: word === null ? undefined : state.selection.replaceRange(word) });
    const hooks = view.state.facet(findHooks);
    if (searchPanelOpen(view.state)) {
      hooks?.asked?.(field);
      return true;
    }
    openSearchPanel(view);
    if (!getSearchQuery(view.state).eq(query)) view.dispatch({ effects: setSearchQuery.of(query) });
    if (field !== 'search') hooks?.asked?.(field);
    return true;
  };
}

function bridge(view: EditorView): Panel {
  const hooks = view.state.facet(findHooks);
  const moved = (update: ViewUpdate): boolean =>
    update.docChanged ||
    update.selectionSet ||
    update.startState.readOnly !== update.state.readOnly ||
    getSearchQuery(update.startState) !== getSearchQuery(update.state);
  return {
    dom: view.dom.ownerDocument.createElement('div'),
    mount: () => hooks?.opened?.(view),
    update: (update) => {
      if (moved(update)) hooks?.moved?.(update.view);
    },
    destroy: () => hooks?.closed?.(),
  };
}

export const finder = [
  search({ literal: true, createPanel: bridge }),
  keymap.of([
    { key: 'Mod-f', run: opener('search'), scope: 'editor search-panel', preventDefault: true },
    { key: 'Mod-Alt-f', run: opener('replace'), scope: 'editor', preventDefault: true },
    ...searchKeymap,
  ]),
  matches,
  rulerSources.of({ lane: 'right', read: (state) => state.field(matches).set, colour: inkOf }),
  EditorView.scrollMargins.of((view) => {
    const cover = view.state.facet(findHooks)?.cover;
    return cover === undefined || !searchPanelOpen(view.state) ? null : { top: cover() };
  }),
];

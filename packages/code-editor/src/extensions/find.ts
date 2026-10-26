import { getSearchQuery, search, searchKeymap, searchPanelOpen, type SearchQuery } from '@codemirror/search';
import { type EditorState, type Range, RangeSet, StateField, type Text } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { Ink, inkOf, rulerSources } from './ruler';

const MATCH_CAP = 5_000;
const MATCH = new Ink('var(--muted-foreground)');

type Found = { readonly query: SearchQuery | null; readonly set: RangeSet<Ink> };

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

const EMPTY: Found = { query: null, set: RangeSet.empty };

const matches = StateField.define<Found>({
  create: () => EMPTY,
  update(found, tr) {
    const query = searched(tr.state);
    if (query === null) return found.query === null ? found : EMPTY;
    const doc = tr.state.doc;
    if (found.query === null || !found.query.eq(query)) return { query, set: RangeSet.of(scan(doc, query, 0, doc.length)) };
    if (!tr.docChanged) return found;
    let set = found.set.map(tr.changes);
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = doc.lineAt(fromB).from;
      const to = doc.lineAt(toB).to;
      set = set.update({ filter: () => false, filterFrom: from, filterTo: to, add: scan(doc, query, from, to) });
    });
    return { query, set };
  },
});

export const find = [
  search({ top: true }),
  keymap.of(searchKeymap),
  matches,
  rulerSources.of({ lane: 'right', read: (state) => state.field(matches).set, colour: inkOf }),
];

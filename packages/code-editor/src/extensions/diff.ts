import { EditorState, Facet, type Range, RangeSet, StateEffect, StateField, type Text, type TransactionSpec } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { SEPARATOR } from '../lineChanges';
import type { DiffKind, DiffLine, Expand } from '../marks';
import { pressMarkAt, STRIP_INK, StripMarker } from './gutters';
import { Ink, inkOf, rulerSources } from './ruler';

const REVEAL_LINES = 20;

export type Expanding = { expand: Expand | undefined };

export const setRows = StateEffect.define<readonly DiffLine[]>();
export const expanding = Facet.define<Expanding, Expanding | undefined>({ combine: (values) => values.at(-1) });
export const expandable = Facet.define<boolean, boolean>({ combine: (values) => values.at(-1) ?? false });

type Changed = Exclude<DiffKind, 'context'>;
type Rows = { readonly lines: readonly DiffLine[]; readonly kinds: RangeSet<Ink> };

const KIND: Record<Changed, Ink> = { added: new Ink(STRIP_INK.added), removed: new Ink(STRIP_INK.removed) };

function kindsOf(doc: Text, lines: readonly DiffLine[]): RangeSet<Ink> {
  const runs: Range<Ink>[] = [];
  let open: { kind: Changed; first: number; last: number } | undefined;
  const close = (): void => {
    if (open !== undefined) runs.push(KIND[open.kind].range(doc.line(open.first + 1).from, doc.line(open.last + 1).to));
    open = undefined;
  };
  lines.forEach((line, at) => {
    if (line.kind === 'context') return close();
    if (open !== undefined && open.kind === line.kind && open.last === at - 1) open.last = at;
    else {
      close();
      open = { kind: line.kind, first: at, last: at };
    }
  });
  close();
  return RangeSet.of(runs);
}

const rows = StateField.define<Rows>({
  create: () => ({ lines: [], kinds: RangeSet.empty }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setRows)) return { lines: effect.value, kinds: kindsOf(tr.state.doc, effect.value) };
    return value;
  },
});

export const textOf = (lines: readonly DiffLine[]): string => lines.map((line) => line.text).join(SEPARATOR);

export function seenAfter(view: EditorView): number | null {
  const { state } = view;
  const lines = state.field(rows).lines;
  const head = state.selection.main.head;
  const from = head === 0 ? (view.visibleRanges[0]?.from ?? 0) : head;
  const at = state.doc.lineAt(from).number - 1;
  for (let next = at; next < lines.length; next += 1) {
    const after = lines[next]?.after;
    if (after !== null && after !== undefined) return after;
  }
  for (let back = at - 1; back >= 0; back -= 1) {
    const after = lines[back]?.after;
    if (after !== null && after !== undefined) return after;
  }
  return null;
}

export const initialRows = (lines: readonly DiffLine[]) => rows.init((state) => ({ lines, kinds: kindsOf(state.doc, lines) }));

export function rowsChange(state: EditorState, next: readonly DiffLine[], also: readonly StateEffect<unknown>[] = []): TransactionSpec {
  const now = state.field(rows).lines;
  const effects = [...also, setRows.of(next)];
  if (now.length === 0 || next.length === 0) return { changes: { from: 0, to: state.doc.length, insert: textOf(next) }, effects };
  let head = 0;
  const shortest = Math.min(now.length, next.length);
  while (head < shortest && now[head]?.text === next[head]?.text) head += 1;
  let tail = 0;
  while (tail < shortest - head && now[now.length - 1 - tail]?.text === next[next.length - 1 - tail]?.text) tail += 1;
  const doc = state.doc;
  const gone = now.length - tail > head;
  const made = next.length - tail > head;
  const inserted = textOf(next.slice(head, next.length - tail));
  if (gone && made) return { changes: { from: doc.line(head + 1).from, to: doc.line(now.length - tail).to, insert: inserted }, effects };
  if (gone) {
    const changes =
      head > 0 ? { from: doc.line(head).to, to: doc.line(now.length - tail).to } : { from: 0, to: doc.line(now.length - tail + 1).from };
    return { changes, effects };
  }
  if (!made) return { effects };
  if (head < now.length) return { changes: { from: doc.line(head + 1).from, insert: inserted + SEPARATOR }, effects };
  return { changes: { from: doc.length, insert: SEPARATOR + inserted }, effects };
}

class Hidden extends WidgetType {
  constructor(
    readonly at: number,
    readonly lines: number,
    readonly open: boolean,
  ) {
    super();
  }

  override eq(other: Hidden): boolean {
    return other.at === this.at && other.lines === this.lines && other.open === this.open;
  }

  override toDOM(view: EditorView): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cm-diff-hidden';
    const label = document.createElement('span');
    label.textContent = `${this.lines.toLocaleString()} unchanged lines`;
    row.append(label);
    if (this.open) {
      const press = (text: string, lines: number): void => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => void view.state.facet(expanding)?.expand?.(this.at, lines));
        row.append(button);
      };
      if (this.lines > REVEAL_LINES) press(`Show ${REVEAL_LINES}`, REVEAL_LINES);
      press('Show all', this.lines);
    }
    return row;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function hiddenOf(state: EditorState): DecorationSet {
  const open = state.facet(expandable);
  const widgets: Range<Decoration>[] = [];
  state.field(rows).lines.forEach((line, at) => {
    if (line.hiddenBefore <= 0) return;
    const widget = new Hidden(line.hiddenAt, line.hiddenBefore, open);
    widgets.push(Decoration.widget({ widget, block: true, side: -1 }).range(state.doc.line(at + 1).from));
  });
  return Decoration.set(widgets);
}

const hidden = StateField.define<DecorationSet>({
  create: hiddenOf,
  update(value, tr) {
    if (tr.state.field(rows) !== tr.startState.field(rows) || tr.state.facet(expandable) !== tr.startState.facet(expandable))
      return hiddenOf(tr.state);
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const LINE_CLASS = {
  added: Decoration.line({ class: 'cm-diff-added' }),
  removed: Decoration.line({ class: 'cm-diff-removed' }),
};
const SPAN_CLASS = {
  added: Decoration.mark({ class: 'cm-diff-span-added' }),
  removed: Decoration.mark({ class: 'cm-diff-span-removed' }),
};

class Kinds {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.#build(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.state.field(rows) !== update.startState.field(rows)) {
      this.decorations = this.#build(update.view);
    }
  }

  #build(view: EditorView): DecorationSet {
    const doc = view.state.doc;
    const lines = view.state.field(rows).lines;
    const made: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
      for (let number = doc.lineAt(from).number, last = doc.lineAt(to).number; number <= last; number += 1) {
        const row = lines[number - 1];
        if (row === undefined || row.kind === 'context') continue;
        const line = doc.line(number);
        made.push(LINE_CLASS[row.kind].range(line.from));
        for (const span of row.spans) {
          const start = line.from + Math.min(span.start, line.length);
          const end = line.from + Math.min(span.end, line.length);
          if (end > start) made.push(SPAN_CLASS[row.kind].range(start, end));
        }
      }
    }
    return Decoration.set(made, true);
  }
}

class NumberMarker extends GutterMarker {
  constructor(readonly value: number) {
    super();
  }

  override eq(other: NumberMarker): boolean {
    return other.value === this.value;
  }

  override toDOM(): Node {
    return document.createTextNode(String(this.value));
  }
}

const rowAt = (view: EditorView, from: number): DiffLine | undefined =>
  view.state.field(rows).lines[view.state.doc.lineAt(from).number - 1];

const rowsMoved = (update: ViewUpdate): boolean => update.state.field(rows) !== update.startState.field(rows);

const numbers = gutter({
  class: 'cm-diff-number',
  lineMarker(view, line) {
    const row = rowAt(view, line.from);
    const value = row === undefined ? null : (row.after ?? row.before);
    return value === null ? null : new NumberMarker(value);
  },
  lineMarkerChange: rowsMoved,
  initialSpacer: (view) => new NumberMarker(Math.max(1, view.state.field(rows).lines.length)),
});

function keptText(state: EditorState, from: number, to: number): string {
  const lines = state.field(rows).lines;
  const doc = state.doc;
  let kept = '';
  for (let number = doc.lineAt(from).number, last = doc.lineAt(to).number; number <= last; number += 1) {
    if (lines[number - 1]?.kind === 'removed') continue;
    const line = doc.line(number);
    kept += doc.sliceString(Math.max(from, line.from), Math.min(to, line.to));
    if (to > line.to) kept += SEPARATOR;
  }
  return kept;
}

function copied(state: EditorState): string {
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length > 0) return ranges.map((range) => keptText(state, range.from, range.to)).join(SEPARATOR);
  const lines = state.field(rows).lines;
  const kept: string[] = [];
  let upto = -1;
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from);
    if (line.number > upto && lines[line.number - 1]?.kind !== 'removed') kept.push(line.text);
    upto = line.number;
  }
  return kept.join(SEPARATOR);
}

const copyKept = EditorView.domEventHandlers({
  copy(event, view) {
    const data = event.clipboardData;
    if (data === null) return false;
    event.preventDefault();
    data.clearData();
    data.setData('text/plain', copied(view.state));
    return true;
  },
});

export const diffView = [
  EditorState.lineSeparator.of(SEPARATOR),
  rows,
  hidden,
  ViewPlugin.fromClass(Kinds, { decorations: (plugin) => plugin.decorations }),
  EditorState.readOnly.of(true),
  numbers,
  gutter({
    class: 'cm-strips',
    lineMarker(view, line) {
      const row = rowAt(view, line.from);
      if (row === undefined || (row.kind === 'context' && row.mark === null)) return null;
      return new StripMarker(row.mark?.colour ?? (row.kind === 'context' ? 'transparent' : STRIP_INK[row.kind]), 'diff', row.mark);
    },
    lineMarkerChange: rowsMoved,
    domEventHandlers: {
      click: (view, line) => pressMarkAt(view, rowAt(view, line.from)?.mark ?? null),
    },
  }),
  copyKept,
  EditorView.clipboardOutputFilter.of((_text, state) => copied(state)),
  rulerSources.of({ lane: 'left', read: (state) => state.field(rows).kinds, colour: inkOf }),
];

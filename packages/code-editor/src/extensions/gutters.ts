import { Facet, type Range, RangeSet, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { LineMarker, LineRange, Mark, PressMark, Strip, StripKind } from '../marks';
import { Ink, inkOf, rulerSources } from './ruler';

export const STRIP_INK: Record<StripKind, string> = {
  added: 'var(--status-done)',
  changed: 'var(--mutation)',
  removed: 'var(--severity-lie)',
};

const CONFLICT = new Ink('var(--severity-gap)');

export type Hooks = { pressMark: PressMark | undefined };

export const hooks = Facet.define<Hooks, Hooks | undefined>({ combine: (values) => values.at(-1) });

export class StripMarker extends GutterMarker {
  constructor(
    readonly colour: string,
    readonly kind: string,
    readonly mark: Mark | null,
  ) {
    super();
  }

  override eq(other: StripMarker): boolean {
    return other.kind === this.kind && other.colour === this.colour && other.mark?.label === this.mark?.label;
  }

  override toDOM(): Node {
    const strip = document.createElement('div');
    strip.className = `cm-strip cm-strip-${this.kind}`;
    strip.style.setProperty('--strip', this.colour);
    if (this.mark !== null) strip.title = this.mark.label;
    return strip;
  }
}

class DotMarker extends GutterMarker {
  constructor(
    readonly label: string,
    readonly colour: string,
  ) {
    super();
  }

  override eq(other: DotMarker): boolean {
    return other.label === this.label && other.colour === this.colour;
  }

  override toDOM(): Node {
    const dot = document.createElement('div');
    dot.className = 'cm-line-dot';
    dot.style.background = this.colour;
    dot.title = this.label;
    return dot;
  }
}

const clampLine = (doc: Text, line: number): number => Math.min(Math.max(line, 0), doc.lines - 1) + 1;
const lineFrom = (doc: Text, line: number): number => doc.line(clampLine(doc, line)).from;
const lineTo = (doc: Text, line: number): number => doc.line(clampLine(doc, line)).to;

export const setStrips = StateEffect.define<readonly Strip[]>();
export const setLineMarkers = StateEffect.define<readonly LineMarker[]>();
export const setConflicts = StateEffect.define<readonly LineRange[]>();

function stripsAt(doc: Text, strips: readonly Strip[]): RangeSet<StripMarker> {
  const ranges: Range<StripMarker>[] = [];
  for (const strip of strips) {
    const marker = new StripMarker(strip.mark?.colour ?? STRIP_INK[strip.kind], strip.kind, strip.mark);
    if (strip.kind === 'removed' || strip.to <= strip.from) ranges.push(marker.range(lineFrom(doc, strip.from)));
    else ranges.push(marker.range(lineFrom(doc, strip.from), lineTo(doc, strip.to - 1)));
  }
  return RangeSet.of(ranges, true);
}

const strips = StateField.define<RangeSet<StripMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = tr.docChanged ? value.map(tr.changes) : value;
    for (const effect of tr.effects) if (effect.is(setStrips)) next = stripsAt(tr.state.doc, effect.value);
    return next;
  },
});

const lineMarkers = StateField.define<RangeSet<DotMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = tr.docChanged ? value.map(tr.changes) : value;
    for (const effect of tr.effects) {
      if (!effect.is(setLineMarkers)) continue;
      next = RangeSet.of(
        effect.value.map((marker) => new DotMarker(marker.label, marker.colour).range(lineFrom(tr.state.doc, marker.line))),
        true,
      );
    }
    return next;
  },
});

const conflicts = StateField.define<RangeSet<Ink>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = tr.docChanged ? value.map(tr.changes) : value;
    for (const effect of tr.effects) {
      if (!effect.is(setConflicts)) continue;
      const doc = tr.state.doc;
      next = RangeSet.of(
        effect.value
          .filter((range) => range.to > range.from)
          .map((range) => CONFLICT.range(lineFrom(doc, range.from), lineTo(doc, range.to - 1))),
        true,
      );
    }
    return next;
  },
});

const conflictLine = Decoration.line({ class: 'cm-conflict' });

class ConflictLines {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.#build(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.state.field(conflicts) !== update.startState.field(conflicts)) {
      this.decorations = this.#build(update.view);
    }
  }

  #build(view: EditorView): DecorationSet {
    const set = view.state.field(conflicts);
    if (set.size === 0) return Decoration.none;
    const doc = view.state.doc;
    const lines: Range<Decoration>[] = [];
    for (const visible of view.visibleRanges) {
      set.between(visible.from, visible.to, (from, to) => {
        const first = doc.lineAt(Math.max(from, visible.from)).number;
        const last = doc.lineAt(Math.min(to, visible.to)).number;
        for (let number = first; number <= last; number += 1) lines.push(conflictLine.range(doc.line(number).from));
      });
    }
    return Decoration.set(lines, true);
  }
}

export const STRIP_SPACER = new StripMarker('transparent', 'spacer', null);

export function pressMarkAt(view: EditorView, mark: Mark | null): boolean {
  const press = view.state.facet(hooks)?.pressMark;
  if (mark === null || press === undefined) return false;
  press(mark);
  return true;
}

export const lineGutters = [
  strips,
  lineMarkers,
  conflicts,
  ViewPlugin.fromClass(ConflictLines, { decorations: (plugin) => plugin.decorations }),
  gutter({
    class: 'cm-markers',
    markers: (view) => view.state.field(lineMarkers),
  }),
  gutter({
    class: 'cm-strips',
    lineMarker(view, line) {
      let found: StripMarker | null = null;
      view.state.field(strips).between(line.from, line.from, (_from, _to, marker) => {
        found = marker;
        return false;
      });
      return found;
    },
    lineMarkerChange: (update) => update.startState.field(strips) !== update.state.field(strips),
    initialSpacer: () => STRIP_SPACER,
    domEventHandlers: {
      click(view, line) {
        let mark: Mark | null = null;
        view.state.field(strips).between(line.from, line.from, (_from, _to, marker) => {
          mark = marker.mark;
          return false;
        });
        return pressMarkAt(view, mark);
      },
    },
  }),
  rulerSources.of({ lane: 'left', read: (state) => state.field(strips), colour: (value) => (value as StripMarker).colour }),
  rulerSources.of({ lane: 'whole', read: (state) => state.field(conflicts), colour: inkOf }),
];

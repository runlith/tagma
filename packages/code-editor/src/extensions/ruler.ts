import { type EditorState, Facet, type RangeSet, RangeValue } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export type RulerLane = 'left' | 'right' | 'whole';

export type RulerSource = {
  readonly lane: RulerLane;
  read(state: EditorState): RangeSet<RangeValue>;
  colour(value: RangeValue): string;
};

export class Ink extends RangeValue {
  constructor(readonly colour: string) {
    super();
  }

  override eq(other: RangeValue): boolean {
    return other instanceof Ink && other.colour === this.colour;
  }
}

export const inkOf = (value: RangeValue): string => (value as Ink).colour;

export const rulerSources = Facet.define<RulerSource>();

const LANES: readonly RulerLane[] = ['left', 'right', 'whole'];

type Rows = Record<RulerLane, (string | null)[]>;

type Dirty = { readonly lo: number; readonly hi: number } | 'all' | null;

type Layout = { rows: Rows | null; cursor: number; frameTop: number; frameHeight: number; height: number };

const fresh = (height: number): Rows => ({
  left: new Array(height).fill(null),
  right: new Array(height).fill(null),
  whole: new Array(height).fill(null),
});

class Ruler {
  readonly #dom: HTMLElement;
  readonly #lanes: Record<RulerLane, HTMLElement>;
  readonly #frame: HTMLElement;
  readonly #cursor: HTMLElement;
  readonly #drawn: Record<RulerLane, string> = { left: '', right: '', whole: '' };
  readonly #onScroll = () => this.#measure();
  #rows: Rows = fresh(0);
  #dirty: Dirty = 'all';
  #drag: number | undefined;

  constructor(private readonly view: EditorView) {
    const make = (name: string): HTMLElement => {
      const element = document.createElement('div');
      element.className = name;
      return element;
    };
    this.#dom = make('cm-ruler');
    this.#lanes = { left: make('cm-ruler-lane'), right: make('cm-ruler-lane'), whole: make('cm-ruler-lane') };
    this.#frame = make('cm-ruler-frame');
    this.#cursor = make('cm-ruler-cursor');
    this.#dom.append(...LANES.map((lane) => this.#lanes[lane]), this.#frame, this.#cursor);
    this.#dom.setAttribute('aria-hidden', 'true');
    this.#dom.addEventListener('pointerdown', (event) => this.#press(event));
    this.#dom.addEventListener('pointermove', (event) => this.#move(event));
    this.#dom.addEventListener('pointerup', (event) => this.#release(event));
    this.#dom.addEventListener('pointercancel', (event) => this.#release(event));
    view.dom.appendChild(this.#dom);
    view.scrollDOM.addEventListener('scroll', this.#onScroll, { passive: true });
    this.#measure();
  }

  update(update: ViewUpdate): void {
    const sources = update.state.facet(rulerSources);
    const replaced =
      sources !== update.startState.facet(rulerSources) ||
      update.heightChanged ||
      update.geometryChanged ||
      update.transactions.some((tr) => tr.effects.length > 0 && tr.docChanged) ||
      (!update.docChanged && sources.some((source) => source.read(update.state) !== source.read(update.startState)));
    if (replaced) this.#dirty = 'all';
    else if (update.docChanged && this.#dirty !== 'all') {
      let lo = this.#dirty === null ? Number.POSITIVE_INFINITY : update.changes.mapPos(this.#dirty.lo, -1);
      let hi = this.#dirty === null ? Number.NEGATIVE_INFINITY : update.changes.mapPos(this.#dirty.hi, 1);
      update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        lo = Math.min(lo, fromB);
        hi = Math.max(hi, toB);
      });
      this.#dirty = { lo, hi };
    }
    if (this.#dirty !== null || update.selectionSet) this.#measure();
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener('scroll', this.#onScroll);
    this.#dom.remove();
  }

  #measure(): void {
    this.view.requestMeasure({ key: this, read: () => this.#layout(), write: (layout) => this.#draw(layout) });
  }

  #layout(): Layout {
    const { view } = this;
    const height = Math.floor(this.#dom.clientHeight);
    const scroller = view.scrollDOM;
    const total = Math.max(scroller.scrollHeight, 1);
    const scale = height / total;
    const top = view.documentPadding.top;
    const dirty = this.#dirty;
    this.#dirty = null;
    let rows: Rows | null = null;
    if (dirty === 'all' || this.#rows.left.length !== height) {
      rows = fresh(height);
      this.#raster(rows, 0, height, scale, top);
    } else if (dirty !== null) {
      rows = this.#rows;
      const doc = view.state.doc;
      const first = Math.floor((view.lineBlockAt(Math.min(dirty.lo, doc.length)).top + top) * scale);
      const last = Math.ceil((view.lineBlockAt(Math.min(dirty.hi, doc.length)).bottom + top) * scale);
      this.#raster(rows, Math.max(first, 0), Math.min(last + 1, height), scale, top);
    }
    return {
      rows,
      cursor: (view.lineBlockAt(view.state.selection.main.head).top + top) * scale,
      frameTop: (scroller.scrollTop / total) * height,
      frameHeight: (scroller.clientHeight / total) * height,
      height,
    };
  }

  #raster(rows: Rows, first: number, last: number, scale: number, top: number): void {
    const { view } = this;
    const sources = view.state.facet(rulerSources).map((source) => ({ source, set: source.read(view.state) }));
    const bottom = view.contentHeight - 0.5;
    for (let y = first; y < last; y += 1) {
      for (const lane of LANES) rows[lane][y] = null;
      const start = y / scale - top;
      const end = (y + 1) / scale - top;
      if (end <= 0 || start >= view.contentHeight) continue;
      const from = view.lineBlockAtHeight(Math.min(Math.max(start, 0), bottom)).from;
      const to = view.lineBlockAtHeight(Math.min(end, bottom)).to;
      for (const { source, set } of sources) {
        if (rows[source.lane][y] !== null) continue;
        set.between(from, to, (_start, _end, value) => {
          rows[source.lane][y] = source.colour(value);
          return false;
        });
      }
    }
  }

  #draw(layout: Layout): void {
    if (layout.rows !== null) {
      this.#rows = layout.rows;
      for (const lane of LANES) this.#paint(lane, layout.rows[lane]);
    }
    this.#cursor.style.top = `${layout.cursor}px`;
    this.#frame.style.top = `${layout.frameTop}px`;
    this.#frame.style.height = `${Math.max(layout.frameHeight, 2)}px`;
    this.#frame.hidden = layout.frameHeight >= layout.height;
  }

  #paint(lane: RulerLane, rows: readonly (string | null)[]): void {
    const runs: { top: number; height: number; colour: string }[] = [];
    for (let y = 0; y < rows.length; y += 1) {
      const colour = rows[y];
      if (colour === null || colour === undefined) continue;
      const open = runs.at(-1);
      if (open !== undefined && open.colour === colour && open.top + open.height === y) open.height += 1;
      else runs.push({ top: y, height: 1, colour });
    }
    const key = runs.map((run) => `${run.top}:${run.height}:${run.colour}`).join('|');
    if (key === this.#drawn[lane]) return;
    this.#drawn[lane] = key;
    this.#lanes[lane].replaceChildren(
      ...runs.map((run) => {
        const piece = document.createElement('div');
        piece.className = `cm-ruler-mark cm-ruler-${lane}`;
        piece.style.top = `${run.top}px`;
        piece.style.height = `${run.height}px`;
        piece.style.background = run.colour;
        return piece;
      }),
    );
  }

  #press(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.#dom.setPointerCapture(event.pointerId);
    this.#drag = event.pointerId;
    this.#scrollTo(event.clientY);
  }

  #move(event: PointerEvent): void {
    if (this.#drag === event.pointerId) this.#scrollTo(event.clientY);
  }

  #release(event: PointerEvent): void {
    if (this.#drag !== event.pointerId) return;
    this.#drag = undefined;
    this.#dom.releasePointerCapture(event.pointerId);
  }

  #scrollTo(clientY: number): void {
    const box = this.#dom.getBoundingClientRect();
    const scroller = this.view.scrollDOM;
    const share = Math.min(Math.max((clientY - box.top) / Math.max(box.height, 1), 0), 1);
    scroller.scrollTop = share * scroller.scrollHeight - scroller.clientHeight / 2;
  }
}

export const ruler = ViewPlugin.define((view) => new Ruler(view));

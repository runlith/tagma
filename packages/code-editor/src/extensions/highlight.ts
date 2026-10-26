import { Facet, type Range, StateEffect } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { CodeToken } from '@runlith/highlight/colours';
import { type DocumentSession, openSession, type SessionEvent } from '@runlith/highlight/session';
import type { Colouring } from '../marks';
import { lineEditsOf } from '../lineChanges';

export type ColouringConfig = {
  readonly language: string | undefined;
  readonly report: { onColouring: ((colouring: Colouring) => void) | undefined };
};

export const colouringConfig = Facet.define<ColouringConfig, ColouringConfig | undefined>({ combine: (values) => values.at(-1) });

type Window = { from: number; to: number };
type Tokens = CodeToken[] | null | undefined;

const arrived = StateEffect.define<null>();
const MARGIN_SCREENS = 3;
const MARGIN_FLOOR = 300;
const inks = new Map<string, Decoration>();

function ink(colour: string): Decoration {
  let made = inks.get(colour);
  if (made === undefined) {
    made = Decoration.mark({ attributes: { style: `color: ${colour}` } });
    inks.set(colour, made);
  }
  return made;
}

function windowOf(view: EditorView): Window {
  const doc = view.state.doc;
  return { from: doc.lineAt(view.viewport.from).number - 1, to: doc.lineAt(view.viewport.to).number };
}

class Painter {
  decorations: DecorationSet = Decoration.none;
  #config: ColouringConfig | undefined;
  #session: DocumentSession | undefined;
  #cache: Tokens[] = [];
  #cacheFrom = 0;
  #version = 0;
  #window: Window = { from: 0, to: 0 };
  #told = false;
  #live = true;

  constructor(private readonly view: EditorView) {
    this.#config = view.state.facet(colouringConfig);
    this.#open();
  }

  update(update: ViewUpdate): void {
    const config = update.state.facet(colouringConfig);
    if (config !== this.#config) this.#configure(config);
    if (update.docChanged) {
      for (const tr of update.transactions) {
        if (!tr.docChanged) continue;
        const edits = lineEditsOf(tr.changes, tr.startState.doc, tr.state.doc);
        this.#version += 1;
        for (let at = edits.length - 1; at >= 0; at -= 1) {
          const { from, to, lines } = edits[at] as (typeof edits)[number];
          this.#shift(from, to, lines.length);
        }
        this.#session?.edit(this.#version, edits);
      }
      this.decorations = this.decorations.map(update.changes);
    }
    if (update.viewportChanged || update.docChanged) this.#ask();
    if (update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(arrived)))) {
      this.decorations = this.#build();
    }
  }

  destroy(): void {
    this.#live = false;
    this.#session?.close();
  }

  #configure(config: ColouringConfig | undefined): void {
    const before = this.#config;
    this.#config = config;
    if (config === undefined || before === undefined || config.language !== before.language) {
      this.#session?.close();
      this.#session = undefined;
      this.#cache = [];
      this.#open();
    }
  }

  #open(): void {
    const config = this.#config;
    this.#told = false;
    this.#window = { from: 0, to: 0 };
    if (config === undefined) return;
    this.#session = openSession(this.view.state.doc.toString(), config.language, this.#version, (event) => this.#take(event));
    if (this.#session === undefined) this.#tell({ kind: 'failed', message: 'This page cannot start a worker to colour code' });
    this.#ask();
  }

  #tell(colouring: Colouring): void {
    this.#config?.report.onColouring?.(colouring);
  }

  #shift(from: number, to: number, made: number): void {
    const end = this.#cacheFrom + this.#cache.length;
    if (to <= this.#cacheFrom) {
      this.#cacheFrom += made - (to - from);
      return;
    }
    if (from >= end) return;
    const head = this.#cache.slice(0, Math.max(0, from - this.#cacheFrom));
    const tail = this.#cache.slice(Math.max(0, to - this.#cacheFrom));
    this.#cache = head.concat(new Array<Tokens>(made), tail);
    this.#cacheFrom = Math.min(this.#cacheFrom, from);
  }

  #ask(): void {
    const wanted = windowOf(this.view);
    if (wanted.from === this.#window.from && wanted.to === this.#window.to) return;
    this.#window = wanted;
    this.#keep(wanted);
    this.#session?.viewport(wanted.from, wanted.to);
  }

  #keep(window: Window): void {
    const margin = Math.max(MARGIN_FLOOR, (window.to - window.from) * MARGIN_SCREENS);
    const from = Math.max(0, window.from - margin);
    const to = window.to + margin;
    const end = this.#cacheFrom + this.#cache.length;
    if (to <= this.#cacheFrom || from >= end) {
      this.#cacheFrom = from;
      this.#cache = [];
      return;
    }
    const kept = this.#cache.slice(Math.max(0, from - this.#cacheFrom), Math.max(0, to - this.#cacheFrom));
    this.#cache = new Array<Tokens>(Math.max(0, this.#cacheFrom - from)).concat(kept);
    this.#cacheFrom = from;
  }

  #take(event: SessionEvent): void {
    if (!this.#live) return;
    if (event.kind === 'plain' || event.kind === 'failed') {
      this.#tell(event.kind === 'plain' ? { kind: 'plain' } : { kind: 'failed', message: event.message });
      return;
    }
    if (event.kind === 'refused') {
      if (event.version !== this.#version) return;
      this.#session?.close();
      this.#cache = [];
      this.#open();
      return;
    }
    if (event.version !== this.#version) return;
    if (!this.#told) {
      this.#told = true;
      this.#tell({ kind: 'coloured' });
    }
    if (event.lines.length === 0) return;
    const margin = Math.max(MARGIN_FLOOR, (this.#window.to - this.#window.from) * MARGIN_SCREENS);
    const from = Math.max(event.from, this.#window.from - margin, this.#cacheFrom);
    const to = Math.min(event.to, this.#window.to + margin);
    for (let at = from; at < to; at += 1) this.#cache[at - this.#cacheFrom] = event.lines[at - event.from];
    if (event.from < this.#window.to && event.to > this.#window.from) this.view.dispatch({ effects: arrived.of(null) });
  }

  #build(): DecorationSet {
    const doc = this.view.state.doc;
    const marks: Range<Decoration>[] = [];
    for (const { from, to } of this.view.visibleRanges) {
      for (let number = doc.lineAt(from).number, last = doc.lineAt(to).number; number <= last; number += 1) {
        const line = doc.line(number);
        const tokens = this.#cache[number - 1 - this.#cacheFrom];
        if (tokens === undefined) {
          this.decorations.between(line.from, line.to, (start, end, value) => {
            marks.push(value.range(start, end));
          });
          continue;
        }
        if (tokens === null) continue;
        let at = line.from;
        for (const token of tokens) {
          const end = Math.min(at + token.text.length, line.to);
          if (token.color !== undefined && end > at) marks.push(ink(token.color).range(at, end));
          at = end;
        }
      }
    }
    return Decoration.set(marks, true);
  }
}

export const highlight = ViewPlugin.fromClass(Painter, { decorations: (plugin) => plugin.decorations });

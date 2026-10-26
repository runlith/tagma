import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { Annotation, ChangeSet, EditorState, type Extension, Prec, type StateCommand, Text, Transaction } from '@codemirror/state';
import { EditorView, keymap, ViewPlugin } from '@codemirror/view';
import { type LineEdit, type LineEditsRefused, splitBodies } from '@runlith/files/lines';
import { Result } from 'effect';
import { changeSetOf, type LineSpan, lineEditsOf, lineSpans, SEPARATOR } from './lineChanges';
import type { LineRange } from './marks';

export type Rebased =
  | { readonly kind: 'applied' }
  | { readonly kind: 'conflict'; readonly ranges: readonly LineRange[] }
  | { readonly kind: 'refused'; readonly reason: LineEditsRefused };

export type Pending = { readonly edits: readonly LineEdit[]; readonly digest: string };

export type DocumentEvent = 'edit' | 'remote' | 'base';

type Snapshot = { readonly local: ChangeSet; readonly revision: number; readonly baseRevision: number };

const APPLIED: Rebased = { kind: 'applied' };
const synced = Annotation.define<true>();
const snapshots = new WeakMap<Pending, Snapshot>();

const lines: Extension = [
  EditorState.lineSeparator.of(SEPARATOR),
  EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n/g, SEPARATOR)),
];

function clashes(ours: LineSpan, theirs: LineEdit): boolean {
  const mine = ours.a1 > ours.a0;
  const other = theirs.to > theirs.from;
  if (mine && other) return ours.a0 < theirs.to && theirs.from < ours.a1;
  if (other) return theirs.from < ours.a0 && ours.a0 < theirs.to;
  if (mine) return ours.a0 < theirs.from && theirs.from < ours.a1;
  return ours.a0 === theirs.from;
}

export class TextDocument {
  readonly #views = new Set<EditorView>();
  readonly #listeners = new Set<(event: DocumentEvent) => void>();
  #state: EditorState;
  #base: Text;
  #digest: string;
  #local: ChangeSet;
  #revision = 0;
  #baseRevision = 0;

  constructor(text: string, digest: string) {
    this.#state = EditorState.create({
      doc: Text.of(splitBodies(text)),
      extensions: [lines, EditorState.allowMultipleSelections.of(true), history()],
    });
    this.#base = this.#state.doc;
    this.#digest = digest;
    this.#local = ChangeSet.empty(this.#base.length);
  }

  get digest(): string {
    return this.#digest;
  }

  get dirty(): boolean {
    let dirty = false;
    this.#local.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      dirty ||= toA - fromA !== inserted.length || this.#base.sliceString(fromA, toA) !== inserted.toString();
    });
    return dirty;
  }

  get doc(): Text {
    return this.#state.doc;
  }

  get baseGeneration(): number {
    return this.#baseRevision;
  }

  get baseText(): string {
    return this.#base.toString();
  }

  read(): string {
    return this.#state.doc.toString();
  }

  replaceText(text: string): void {
    const now = this.#state.doc.toString();
    let head = 0;
    while (head < Math.min(now.length, text.length) && now[head] === text[head]) head += 1;
    let tail = 0;
    while (tail < Math.min(now.length, text.length) - head && now[now.length - 1 - tail] === text[text.length - 1 - tail]) tail += 1;
    if (head + tail === now.length && head + tail === text.length) return;
    const tr = this.#state.update({
      changes: { from: head, to: now.length - tail, insert: text.slice(head, text.length - tail) },
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.restore')],
    });
    this.#commit(tr, null, 'edit');
  }

  subscribe(listener: (event: DocumentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  mount(parent: HTMLElement, extensions: Extension): EditorView {
    const views = this.#views;
    const travel = Prec.high(
      keymap.of([
        { key: 'Mod-z', run: (view) => this.#travel(undo, view), preventDefault: true },
        { key: 'Mod-y', mac: 'Mod-Shift-z', run: (view) => this.#travel(redo, view), preventDefault: true },
        { linux: 'Ctrl-Shift-z', run: (view) => this.#travel(redo, view), preventDefault: true },
      ]),
    );
    const membership = ViewPlugin.define((view) => {
      views.add(view);
      return { destroy: () => views.delete(view) };
    });
    return new EditorView({
      parent,
      state: EditorState.create({ doc: this.#state.doc, extensions: [lines, travel, membership, extensions] }),
      dispatchTransactions: (transactions, view) => this.#take(transactions, view),
    });
  }

  applyRemote(edits: readonly LineEdit[], digest: string): Rebased {
    if (this.dirty) return this.rebase(edits, digest);
    const theirs = changeSetOf(this.#base, edits);
    if (Result.isFailure(theirs)) return { kind: 'refused', reason: theirs.failure };
    this.#merge(theirs.success, digest);
    return APPLIED;
  }

  rebase(edits: readonly LineEdit[], digest: string): Rebased {
    const theirs = changeSetOf(this.#base, edits);
    if (Result.isFailure(theirs)) return { kind: 'refused', reason: theirs.failure };
    const ranges = this.#clashes(edits);
    if (ranges.length > 0) return { kind: 'conflict', ranges };
    this.#merge(theirs.success, digest);
    return APPLIED;
  }

  keepMine(edits: readonly LineEdit[], digest: string): Rebased {
    const theirs = changeSetOf(this.#base, edits);
    if (Result.isFailure(theirs)) return { kind: 'refused', reason: theirs.failure };
    this.#local = theirs.success.invert(this.#base).compose(this.#local);
    this.#moveBase(theirs.success.apply(this.#base), digest);
    return APPLIED;
  }

  discard(): void {
    if (this.#local.empty) return;
    const back = this.#local.invert(this.#base);
    const tr = this.#state.update({ changes: back, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('discard')] });
    this.#commit(tr, null, 'edit');
    this.#local = ChangeSet.empty(this.#base.length);
  }

  pending(): Pending {
    const base = this.#base;
    const edits = lineEditsOf(this.#local, base, this.#state.doc).filter(
      (edit) => edit.to - edit.from !== edit.lines.length || edit.lines.some((line, at) => line !== base.line(edit.from + at + 1).text),
    );
    const pending: Pending = { edits, digest: this.#digest };
    snapshots.set(pending, { local: this.#local, revision: this.#revision, baseRevision: this.#baseRevision });
    return pending;
  }

  settled(written: Pending, digest: string): boolean {
    const snapshot = snapshots.get(written);
    if (snapshot === undefined || snapshot.baseRevision !== this.#baseRevision) return false;
    const before = this.#base;
    this.#local =
      snapshot.revision === this.#revision ? ChangeSet.empty(this.#state.doc.length) : snapshot.local.invert(before).compose(this.#local);
    this.#moveBase(snapshot.local.apply(before), digest);
    return true;
  }

  #take(transactions: readonly Transaction[], view: EditorView): void {
    view.update(transactions);
    for (const tr of transactions) if (tr.docChanged && tr.annotation(synced) === undefined) this.#record(tr, view);
  }

  #moveBase(base: Text, digest: string): void {
    this.#base = base;
    this.#digest = digest;
    this.#baseRevision += 1;
    this.#tell('base');
  }

  #merge(theirs: ChangeSet, digest: string): void {
    const mine = this.#local;
    const onBuffer = theirs.map(mine, true);
    this.#local = mine.map(theirs);
    this.#base = theirs.apply(this.#base);
    this.#digest = digest;
    this.#baseRevision += 1;
    if (onBuffer.empty) {
      this.#tell('base');
      return;
    }
    const tr = this.#state.update({
      changes: onBuffer,
      annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
    });
    this.#commit(tr, null, 'remote');
  }

  #clashes(edits: readonly LineEdit[]): LineRange[] {
    const doc = this.#state.doc;
    const ranges: LineRange[] = [];
    let next = 0;
    for (const span of lineSpans(this.#local, this.#base, doc)) {
      while (next < edits.length && (edits[next] as LineEdit).to < span.a0) next += 1;
      let hit = false;
      for (let at = next; at < edits.length && !hit; at += 1) {
        const theirs = edits[at] as LineEdit;
        if (theirs.from > span.a1) break;
        hit = clashes(span, theirs);
      }
      if (!hit) continue;
      const to = Math.min(Math.max(span.b1, span.b0 + 1), doc.lines);
      const open = ranges.at(-1);
      if (open !== undefined && open.to >= span.b0) ranges[ranges.length - 1] = { from: open.from, to: Math.max(open.to, to) };
      else ranges.push({ from: span.b0, to });
    }
    return ranges;
  }

  #record(tr: Transaction, view: EditorView): void {
    let master = this.#state;
    if (!master.selection.eq(tr.startState.selection)) {
      master = master.update({ selection: tr.startState.selection, annotations: Transaction.addToHistory.of(false) }).state;
    }
    const annotations: Annotation<unknown>[] = [Transaction.time.of(tr.annotation(Transaction.time) ?? Date.now())];
    const event = tr.annotation(Transaction.userEvent);
    if (event !== undefined) annotations.push(Transaction.userEvent.of(event));
    const kept = tr.annotation(Transaction.addToHistory);
    if (kept !== undefined) annotations.push(Transaction.addToHistory.of(kept));
    const isolated = tr.annotation(isolateHistory);
    if (isolated !== undefined) annotations.push(isolateHistory.of(isolated));
    this.#commit(master.update({ changes: tr.changes, selection: tr.newSelection, annotations }), view, 'edit', false);
  }

  #travel(command: StateCommand, view: EditorView): boolean {
    if (view.state.readOnly) return false;
    let made: Transaction | undefined;
    const ran = command({ state: this.#state, dispatch: (tr) => (made = tr) });
    if (!ran || made === undefined) return false;
    this.#commit(made, view, 'edit', true);
    return true;
  }

  #commit(tr: Transaction, source: EditorView | null, event: DocumentEvent, select = false): void {
    this.#state = tr.state;
    this.#revision += 1;
    if (event === 'edit') this.#local = this.#local.compose(tr.changes);
    const told = tr.annotation(Transaction.userEvent);
    const annotations: Annotation<unknown>[] = [synced.of(true)];
    if (event === 'remote') annotations.push(Transaction.remote.of(true), Transaction.addToHistory.of(false));
    if (told !== undefined) annotations.push(Transaction.userEvent.of(told));
    for (const view of this.#views) {
      if (view === source && !select) continue;
      const own = view === source;
      view.dispatch({
        changes: tr.changes,
        selection: own ? tr.newSelection : undefined,
        scrollIntoView: own,
        annotations,
      });
    }
    this.#tell(event);
  }

  #tell(event: DocumentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

import type { PromptSelection } from './composer';
import type { PromptEdit } from './promptEdit';

export type PromptEditor = {
  selection(): PromptSelection | null;
  write(from: number, to: number, text: string, caret: 'preserve' | 'end'): PromptSelection | null;
  caret(offset: number): void;
  focus(): void;
};

export type PromptGhost = { readonly at: number; readonly text: string };

export class PromptMark {
  broken = false;
  text = '';

  constructor(
    public start: number,
    public end: number,
  ) {}

  shift(edit: PromptEdit): void {
    if (this.broken || (edit.from >= this.end && edit.to > this.start)) return;
    if (edit.to > this.start) {
      this.broken = true;
      return;
    }
    const grown = edit.text.length - (edit.to - edit.from);
    this.start += grown;
    this.end += grown;
  }
}

export class PromptHandle {
  ghost = $state.raw<PromptGhost | null>(null);
  alert = $state(false);
  tracking = $state(false);
  private editor = $state.raw<PromptEditor | null>(null);
  private readonly marks = new Set<PromptMark>();

  get attached(): boolean {
    return this.editor !== null;
  }

  attach(editor: PromptEditor): () => void {
    this.breakAll();
    this.editor = editor;
    return () => {
      if (this.editor !== editor) return;
      this.editor = null;
      this.breakAll();
    };
  }

  focus(): void {
    this.editor?.focus();
  }

  selection(): PromptSelection | null {
    return this.editor?.selection() ?? null;
  }

  caret(offset: number): void {
    this.editor?.caret(offset);
  }

  mark(at: number): PromptMark | null {
    if (this.editor === null) return null;
    const mark = new PromptMark(at, at);
    this.marks.add(mark);
    this.tracking = true;
    return mark;
  }

  unmark(mark: PromptMark): void {
    this.marks.delete(mark);
    this.tracking = this.marks.size > 0;
  }

  intact(mark: PromptMark): boolean {
    if (mark.broken || !this.marks.has(mark) || this.editor === null) return false;
    if (this.editor.selection()?.text.slice(mark.start, mark.end) === mark.text) return true;
    mark.broken = true;
    return false;
  }

  fill(mark: PromptMark, text: string): boolean {
    if (!this.intact(mark)) return false;
    if (text === mark.text) return true;
    let same = 0;
    while (same < mark.text.length && same < text.length && mark.text[same] === text[same]) same += 1;
    const edit: PromptEdit = { from: mark.start + same, to: mark.end, text: text.slice(same) };
    const selection = this.editor!.selection();
    const inside = selection !== null && selection.from === selection.to && selection.from >= mark.start && selection.from <= mark.end;
    if (this.editor!.write(edit.from, edit.to, edit.text, inside ? 'end' : 'preserve') === null) {
      mark.broken = true;
      return false;
    }
    for (const other of this.marks) if (other !== mark) other.shift(edit);
    mark.end = mark.start + text.length;
    mark.text = text;
    return true;
  }

  edited(edit: PromptEdit | null): void {
    for (const mark of this.marks) {
      if (edit === null) mark.broken = true;
      else mark.shift(edit);
    }
  }

  private breakAll(): void {
    for (const mark of this.marks) mark.broken = true;
  }
}

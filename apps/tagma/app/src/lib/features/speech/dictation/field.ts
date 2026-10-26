import type { PromptHandle, PromptMark } from '@runlith/chat-ui/PromptHandle.svelte';
import type { Target, Unplaced } from './target.js';

const SPACED = /(^|\s)$/;

const words = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');

const plain = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function beyond(text: string, placed: string): string {
  const said = words(text);
  const stood = words(placed).map(plain);
  if (stood.length === 0) return said.join(' ');
  const keys = said.map(plain);
  let row = new Array<number>(stood.length + 1).fill(0);
  let last = 0;
  let best = 0;
  for (let at = 1; at <= keys.length; at += 1) {
    const next = new Array<number>(stood.length + 1).fill(0);
    for (let on = 1; on <= stood.length; on += 1) {
      next[on] = keys[at - 1] === stood[on - 1] ? row[on - 1]! + 1 : Math.max(row[on]!, next[on - 1]!);
    }
    if (next[stood.length]! > best) {
      best = next[stood.length]!;
      last = at;
    }
    row = next;
  }
  return said.slice(last).join(' ');
}

export class FieldTarget implements Target {
  private mark: PromptMark | null = null;
  private lead = '';
  private bound: string | null = null;

  constructor(
    private readonly handle: PromptHandle,
    private readonly owner: () => string,
    private readonly send: () => void,
  ) {}

  begin(): boolean {
    const selection = this.handle.selection();
    const mark = selection === null ? null : this.handle.mark(selection.to);
    if (selection === null || mark === null) return false;
    this.mark = mark;
    this.bound = this.owner();
    this.lead = SPACED.test(selection.text.slice(0, selection.to)) ? '' : ' ';
    this.handle.alert = true;
    return true;
  }

  show(stable: string, guess: string): boolean {
    const shown = this.render(stable);
    const mark = this.mark;
    this.handle.ghost =
      shown && mark !== null && guess !== '' ? { at: mark.end, text: `${mark.text === '' ? this.lead : ' '}${guess}` } : null;
    return shown;
  }

  async commit(text: string, send: boolean): Promise<Unplaced> {
    const landed = this.render(text);
    const placed = this.mark?.text ?? '';
    this.leave();
    if (landed && send) this.send();
    return landed ? '' : beyond(text, placed);
  }

  revert(): boolean {
    const removed = this.render('');
    this.leave();
    return removed;
  }

  leave(): void {
    if (this.mark !== null) this.handle.unmark(this.mark);
    this.mark = null;
    this.bound = null;
    this.handle.ghost = null;
    this.handle.alert = false;
  }

  private render(stable: string): boolean {
    if (this.mark === null || this.bound === null || this.owner() !== this.bound) return false;
    return this.handle.fill(this.mark, stable === '' ? '' : this.lead + stable);
  }
}

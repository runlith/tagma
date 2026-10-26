import { type LineEdit, type LineEditsRefused, checkLineEdits, splitBodies } from '@runlith/files/lines';
import type { StateStack } from 'shiki/textmate';
import type { CodeToken } from './colours';
import type { LineTokenizer } from './grammar';

export type DocumentColours = {
  version: number;
  from: number;
  to: number;
  lines: (CodeToken[] | null)[];
  settled: boolean;
};

type Window = { from: number; to: number };

const STEP_LINES = 400;
const STEP_MS = 8;

export class TokenDocument {
  #bodies: string[];
  #states: (StateStack | undefined)[];
  #frontier = 0;
  #horizon = 0;
  #dirtyEnd = 0;
  #unsettled = true;
  #window: Window = { from: 0, to: 0 };
  #owed: Window | undefined;

  constructor(
    private readonly tokenizer: LineTokenizer,
    text: string,
    private version: number,
  ) {
    this.#bodies = splitBodies(text);
    this.#states = new Array<StateStack | undefined>(this.#bodies.length + 1).fill(undefined);
    this.#states[0] = tokenizer.initial;
  }

  get busy(): boolean {
    return this.#unsettled || this.#servable() > 0;
  }

  edit(version: number, edits: readonly LineEdit[]): LineEditsRefused | undefined {
    if (version <= this.version) return undefined;
    const refused = checkLineEdits(this.#bodies.length, edits);
    if (refused !== undefined) return refused;
    this.version = version;
    const first = edits[0];
    if (first === undefined) return undefined;
    this.#rebuild(edits);
    let horizon = this.#horizon;
    let dirtyEnd = this.#dirtyEnd;
    for (let at = edits.length - 1; at >= 0; at -= 1) {
      const { from, to, lines } = edits[at] as LineEdit;
      const delta = lines.length - (to - from);
      horizon = horizon >= to ? horizon + delta : Math.min(horizon, from);
      dirtyEnd = dirtyEnd > to ? dirtyEnd + delta : from + lines.length;
    }
    this.#horizon = horizon;
    this.#dirtyEnd = dirtyEnd;
    this.#frontier = Math.min(this.#frontier, first.from);
    this.#unsettled = true;
    return undefined;
  }

  viewport(from: number, to: number): void {
    this.#window = { from, to };
    this.#owed = { from, to };
  }

  step(): DocumentColours | undefined {
    if (this.#servable() > 0) return this.#serve();
    if (!this.#unsettled) return undefined;
    return this.#walk();
  }

  #rebuild(edits: readonly LineEdit[]): void {
    const total = this.#bodies.length;
    const bodies: string[] = [];
    const states: (StateStack | undefined)[] = [];
    let body = 0;
    let state = 0;
    for (const { from, to, lines } of edits) {
      for (; body < from; body += 1) bodies.push(this.#bodies[body] as string);
      for (const line of lines) bodies.push(line);
      body = to;
      for (; state <= from; state += 1) states.push(this.#states[state]);
      if (lines.length > 0) {
        for (let at = 1; at < lines.length; at += 1) states.push(undefined);
        states.push(this.#states[to]);
      }
      state = to + 1;
    }
    for (; body < total; body += 1) bodies.push(this.#bodies[body] as string);
    for (; state <= total; state += 1) states.push(this.#states[state]);
    this.#bodies = bodies;
    this.#states = states;
  }

  #servable(): number {
    const owed = this.#owed;
    if (!owed) return 0;
    owed.to = Math.min(owed.to, this.#bodies.length);
    const count = Math.min(owed.to, this.#frontier) - owed.from;
    if (owed.to <= owed.from) this.#owed = undefined;
    return count;
  }

  #serve(): DocumentColours {
    const owed = this.#owed as Window;
    const from = owed.from;
    const stop = Math.min(owed.to, this.#frontier, from + STEP_LINES);
    const deadline = performance.now() + STEP_MS;
    const lines: (CodeToken[] | null)[] = [];
    for (let at = from; at < stop; at += 1) {
      lines.push(this.tokenizer.line(this.#bodies[at] as string, this.#states[at] as StateStack).tokens);
      if (performance.now() > deadline) break;
    }
    owed.from = from + lines.length;
    if (owed.from >= owed.to) this.#owed = undefined;
    return { version: this.version, from, to: from + lines.length, lines, settled: !this.#unsettled };
  }

  #walk(): DocumentColours | undefined {
    const total = this.#bodies.length;
    const lines: (CodeToken[] | null)[] = [];
    let first = -1;
    const deadline = performance.now() + STEP_MS;
    for (let done = 0; this.#frontier < total; done += 1) {
      const at = this.#frontier;
      const body = this.#bodies[at] as string;
      const start = this.#states[at] as StateStack;
      let end: StateStack;
      if (at >= this.#window.from && at < this.#window.to) {
        const read = this.tokenizer.line(body, start);
        end = read.end;
        if (first < 0) first = at;
        lines.push(read.tokens);
      } else {
        end = this.tokenizer.advance(body, start);
      }
      const standing = this.#states[at + 1];
      this.#frontier = at + 1;
      if (standing !== undefined && at + 1 >= this.#dirtyEnd && end.equals(standing)) {
        this.#frontier = this.#horizon;
        this.#dirtyEnd = 0;
        break;
      }
      this.#states[at + 1] = end;
      if (this.#frontier > this.#horizon) this.#horizon = this.#frontier;
      if (done >= STEP_LINES || performance.now() > deadline) break;
    }
    if (this.#frontier >= total) {
      this.#unsettled = false;
      this.#dirtyEnd = 0;
    }
    const owed = this.#owed;
    if (owed && first >= 0 && owed.from >= first && owed.from < first + lines.length) {
      owed.from = first + lines.length;
      if (owed.from >= owed.to) this.#owed = undefined;
    }
    if (first >= 0) return { version: this.version, from: first, to: first + lines.length, lines, settled: !this.#unsettled };
    if (!this.#unsettled) return { version: this.version, from: 0, to: 0, lines, settled: true };
    return undefined;
  }
}

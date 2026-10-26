import type { TurnMode } from '../wire/capabilities.ts';
import type { SourceUnit, SpeechEvent, Turn, Unit } from '../wire/events.ts';
import type { Gap, Heard, Span, Utterance } from '../wire/heard.ts';

export type Splitting = {
  readonly pauseMs: number;
  readonly maxMs: number;
  readonly lagMs: number;
};

export const splittingDefaults: Splitting = { pauseMs: 1_500, maxMs: 30_000, lagMs: 2_000 };

export type Placing = {
  readonly time: (frame: number) => number;
  readonly commit: (commit: number) => Span | undefined;
  readonly fallback?: Span | undefined;
};

export type Counter = { value: number };

type Line = {
  readonly seq: number;
  units: ReadonlyArray<Unit<Span>>;
  text: string;
  hypothesis: string;
  revision: number;
  first: Span | undefined;
  last: Span | undefined;
  speakers: Set<string>;
  untold: boolean;
  sources: number;
};

type Open = {
  line: Line;
  speechFrom: number | undefined;
  speechTo: number | undefined;
  commit: Span | undefined;
};

const glue = (text: string, unit: Unit<Span>) => {
  if (unit.granularity === 'token' || text === '' || /\s$/.test(text) || /^\s/.test(unit.text)) return text + unit.text;
  return `${text} ${unit.text}`;
};

const placed = (unit: Unit, placing: Placing): Unit<Span> => {
  if (unit.lane === 'translation') return unit;
  const { time, ...rest } = unit;
  if (time === undefined) return rest;
  const scaled: SourceUnit<Span> = { ...rest, time: { from: placing.time(time.from), to: placing.time(time.to) } };
  return scaled;
};

const line = (seq: number): Line => ({
  seq,
  units: [],
  text: '',
  hypothesis: '',
  revision: 0,
  first: undefined,
  last: undefined,
  speakers: new Set(),
  untold: false,
  sources: 0,
});

const grow = (current: Line, unit: SourceUnit<Span>) => {
  current.text = glue(current.text, unit);
  current.sources += 1;
  if (unit.speaker === undefined) current.untold = true;
  else current.speakers.add(unit.speaker);
  if (unit.time !== undefined) {
    current.first ??= unit.time;
    current.last = unit.time;
  }
};

const filled = (seq: number, revision: number, units: ReadonlyArray<Unit<Span>>): Line => {
  const built: Line = { ...line(seq), units, revision };
  for (const unit of units) if (unit.lane === 'source') grow(built, unit);
  return built;
};

const leaning = /^[\p{Pe}\p{Pf}\p{Po}\p{Pd}]/u;
const sentenceEnd = /[.!?…][\p{Pe}\p{Pf}"']*$/u;
const clauseEnd = /[,;:\p{Pd}][\p{Pe}\p{Pf}"']*$/u;

const opensWord = (unit: SourceUnit<Span>) =>
  (unit.granularity !== 'token' || /^\s/.test(unit.text)) && !leaning.test(unit.text.trimStart());

type Boundary = { readonly at: number; readonly rank: number; readonly pause: number };

const better = (left: Boundary, right: Boundary) =>
  right.rank !== left.rank ? right.rank > left.rank : right.rank > 0 || right.pause >= left.pause;

const boundary = (units: ReadonlyArray<Unit<Span>>, next: SourceUnit<Span>, maxMs: number): number => {
  let before: SourceUnit<Span> | undefined;
  let best: Boundary | undefined;
  const weigh = (at: number, start: SourceUnit<Span>) => {
    if (before === undefined || !opensWord(start)) return;
    if (start !== next && start.time !== undefined && next.time !== undefined && next.time.to - start.time.from > maxMs) return;
    const ending = before.text.trimEnd();
    const rank = sentenceEnd.test(ending) ? 2 : clauseEnd.test(ending) ? 1 : 0;
    const pause = start.time !== undefined && before.time !== undefined ? start.time.from - before.time.to : 0;
    const candidate = { at, rank, pause };
    if (best === undefined || better(best, candidate)) best = candidate;
  };
  units.forEach((unit, at) => {
    if (unit.lane !== 'source') return;
    weigh(at, unit);
    before = unit;
  });
  weigh(units.length, next);
  return best?.at ?? units.length;
};

const heardOf = (current: Line) => current.revision > 0 || current.units.length > 0 || current.hypothesis !== '';

export class Assembler {
  private readonly open = new Map<Turn, Open>();
  private confirmedTo: number | undefined;
  private sealed = false;

  constructor(
    readonly track: string,
    readonly segment: number,
    private readonly mode: TurnMode,
    private readonly counter: Counter,
    private readonly splitting: Splitting,
    private readonly placing: Placing,
  ) {}

  get idle(): boolean {
    return this.open.size === 0;
  }

  get confirmed(): number | undefined {
    return this.confirmedTo;
  }

  get unconfirmed(): number | undefined {
    let earliest: number | undefined;
    for (const turn of this.open.values()) {
      const from = turn.line.last?.to ?? this.span(turn, turn.line)?.from;
      if (from !== undefined) earliest = Math.min(earliest ?? from, from);
    }
    return earliest;
  }

  apply(event: SpeechEvent): ReadonlyArray<Heard> {
    if (this.sealed) return [];
    switch (event._tag) {
      case 'Partial': {
        const turn = this.turn(event.turn);
        turn.line.hypothesis = event.text;
        return this.told(turn, turn.line);
      }
      case 'Final':
        return this.append(this.turn(event.turn), event.units);
      case 'TurnEnd': {
        const turn = this.open.get(event.turn);
        if (turn === undefined) return [];
        this.open.delete(event.turn);
        turn.line.hypothesis = '';
        return this.close(turn, turn.line, true);
      }
      case 'TurnFailed':
        return this.failed(event.turn, event.message);
      case 'SpeechStart': {
        const turn = this.turn(event.turn);
        turn.speechFrom = this.placing.time(event.at);
        return turn.line.revision > 0 ? this.told(turn, turn.line) : [];
      }
      case 'SpeechEnd': {
        const turn = this.turn(event.turn);
        turn.speechTo = this.placing.time(event.at);
        return turn.line.revision > 0 ? this.told(turn, turn.line) : [];
      }
      case 'Committed': {
        const turn = this.turn(event.turn);
        turn.commit = this.placing.commit(event.commit);
        return turn.line.revision > 0 ? this.told(turn, turn.line) : [];
      }
      case 'Finalized':
        return this.mode === 'none' ? this.cut() : [];
      case 'Finished':
        return [];
    }
  }

  cut(before?: number): ReadonlyArray<Heard> {
    const heard: Array<Heard> = [];
    for (const turn of this.open.values()) {
      const last = turn.line.last;
      if (turn.line.units.length === 0) continue;
      if (before !== undefined && (last === undefined || last.to >= before)) continue;
      turn.line.hypothesis = '';
      heard.push(...this.close(turn, turn.line, true));
      turn.line = line(this.next());
    }
    return heard;
  }

  quiet(before: number): ReadonlyArray<Heard> {
    return this.mode === 'none' && !this.sealed ? this.cut(before) : [];
  }

  closeAll(): ReadonlyArray<Heard> {
    this.sealed = true;
    const heard: Array<Heard> = [];
    for (const turn of this.open.values()) {
      turn.line.hypothesis = '';
      heard.push(...this.close(turn, turn.line, false));
    }
    this.open.clear();
    return heard;
  }

  private next(): number {
    this.counter.value += 1;
    return this.counter.value;
  }

  private turn(key: Turn): Open {
    const known = this.open.get(key);
    if (known !== undefined) return known;
    const opened: Open = { line: line(this.next()), speechFrom: undefined, speechTo: undefined, commit: undefined };
    this.open.set(key, opened);
    return opened;
  }

  private breaks(current: Line, unit: SourceUnit<Span>): 'length' | 'turn' | undefined {
    if (current.sources === 0 || !opensWord(unit)) return undefined;
    const time = unit.time;
    if (time !== undefined && current.first !== undefined && time.to - current.first.from > this.splitting.maxMs) return 'length';
    if (this.mode !== 'none') return undefined;
    if (unit.speaker !== undefined && current.speakers.size > 0 && !current.speakers.has(unit.speaker)) return 'turn';
    return time !== undefined && current.last !== undefined && time.from - current.last.to > this.splitting.pauseMs ? 'turn' : undefined;
  }

  private divide(turn: Open, at: number): ReadonlyArray<Heard> {
    const current = turn.line;
    const whole = at === current.units.length;
    const kept = whole ? current : filled(current.seq, current.revision, current.units.slice(0, at));
    const heard = this.close(turn, kept, true);
    turn.line = whole ? line(this.next()) : filled(this.next(), 0, current.units.slice(at));
    return heard;
  }

  private append(turn: Open, units: ReadonlyArray<Unit>): ReadonlyArray<Heard> {
    const heard: Array<Heard> = [];
    let added: Array<Unit<Span>> = [];
    const settle = () => {
      if (added.length > 0) turn.line.units = turn.line.units.concat(added);
      added = [];
    };
    turn.line.hypothesis = '';
    for (const raw of units) {
      const unit = placed(raw, this.placing);
      if (unit.lane === 'source') {
        const cause = this.breaks(turn.line, unit);
        if (cause !== undefined) {
          settle();
          const at = cause === 'length' ? boundary(turn.line.units, unit, this.splitting.maxMs) : turn.line.units.length;
          heard.push(...this.divide(turn, at));
        }
        grow(turn.line, unit);
        if (unit.time !== undefined) this.confirmedTo = Math.max(this.confirmedTo ?? unit.time.to, unit.time.to);
      }
      added.push(unit);
    }
    settle();
    heard.push(...this.told(turn, turn.line));
    return heard;
  }

  private failed(key: Turn, message: string): ReadonlyArray<Heard> {
    const turn = this.open.get(key);
    if (turn === undefined) return [];
    this.open.delete(key);
    const span = this.span(turn, turn.line);
    turn.line.hypothesis = '';
    const closed = this.close(turn, turn.line, true);
    if (span === undefined) return closed;
    const gap: Gap = { _tag: 'Gap', track: this.track, from: span.from, to: span.to, cause: 'recognition-failed', message };
    return [...closed, gap];
  }

  private span(turn: Open, current: Line): Span | undefined {
    if (current.first !== undefined && current.last !== undefined) return { from: current.first.from, to: current.last.to };
    if (turn.speechFrom !== undefined && turn.speechTo !== undefined) return { from: turn.speechFrom, to: turn.speechTo };
    return turn.commit ?? this.placing.fallback;
  }

  private close(turn: Open, current: Line, confirmed: boolean): ReadonlyArray<Heard> {
    const span = this.span(turn, current);
    if (confirmed && span !== undefined) this.confirmedTo = Math.max(this.confirmedTo ?? span.to, span.to);
    return heardOf(current) ? [this.utterance(turn, current, true)] : [];
  }

  private told(turn: Open, current: Line): ReadonlyArray<Heard> {
    return heardOf(current) ? [this.utterance(turn, current, false)] : [];
  }

  private utterance(turn: Open, current: Line, closed: boolean): Utterance {
    current.revision += 1;
    const speaker = current.speakers.size === 1 && !current.untold ? [...current.speakers][0] : undefined;
    return {
      _tag: 'Utterance',
      id: { track: this.track, segment: this.segment, seq: current.seq },
      revision: current.revision,
      closed,
      text: current.text.trim(),
      hypothesis: closed ? '' : current.hypothesis,
      units: current.units,
      span: this.span(turn, current),
      speaker,
    };
  }
}

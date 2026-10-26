import type { Heard, TrackPhase } from '@tagma/server/speech/contract/wire/listening';
import type { Target, Unplaced } from './target.js';

export type Utterance = Extract<Heard, { kind: 'utterance' }>;

export type Ending = 'end' | 'deadline' | 'failed';

export type Settled = {
  readonly text: string;
  readonly unplaced: Unplaced;
  readonly confirmed: boolean;
  readonly lost: readonly string[];
};

type Line = {
  readonly key: string;
  readonly seq: number;
  text: string;
  hypothesis: string;
  hint: string;
  revision: number;
  closed: boolean;
};

const joined = (parts: readonly string[]): string =>
  parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');

export class Take {
  private readonly lines = new Map<string, Line>();
  private readonly ordered: Line[] = [];
  private readonly phases = new Map<string, TrackPhase>();
  private readonly gaps: string[] = [];
  private delivered: string | null = null;
  private current = '';
  private shown = '';
  private over = false;

  constructor(private readonly target: Target) {}

  get stable(): string {
    return this.current;
  }

  get guess(): string {
    return this.shown;
  }

  open(): boolean {
    return this.target.begin();
  }

  hear(heard: Heard): void {
    if (this.over) return;
    switch (heard.kind) {
      case 'utterance':
        this.place(heard);
        this.render();
        return;
      case 'track':
        this.phases.set(heard.track, heard.phase);
        return;
      case 'gap': {
        const lost = heard.message === '' ? heard.cause : heard.message;
        if (!this.gaps.includes(lost)) this.gaps.push(lost);
        return;
      }
      case 'level':
      case 'state':
        return;
    }
  }

  async settle(ending: Ending, send: boolean): Promise<Settled | null> {
    if (this.over) return null;
    this.over = true;
    const confirmed = ending === 'end' && this.confirmed();
    const text = this.text(!confirmed);
    const lost = confirmed ? [] : this.missing(ending);
    const sending = send && (confirmed || (ending === 'deadline' && lost.length === 0));
    const unplaced = await this.target.commit(text, sending);
    return { text, unplaced, confirmed, lost };
  }

  cancel(): boolean {
    if (this.over) return true;
    this.over = true;
    return this.target.revert();
  }

  drop(): void {
    if (this.over) return;
    this.over = true;
    this.target.leave();
  }

  private place(heard: Utterance): void {
    const key = `${heard.track}/${heard.segment}/${heard.seq}`;
    const known = this.lines.get(key);
    if (known === undefined) {
      const { seq, text, hypothesis, revision, closed } = heard;
      const line: Line = { key, seq, text, hypothesis, hint: hypothesis, revision, closed };
      this.lines.set(key, line);
      let at = this.ordered.length;
      while (at > 0 && this.ordered[at - 1]!.seq > seq) at -= 1;
      this.ordered.splice(at, 0, line);
      return;
    }
    if (heard.revision <= known.revision) return;
    known.hint = heard.text !== known.text || heard.hypothesis !== '' ? heard.hypothesis : known.hint;
    known.text = heard.text;
    known.hypothesis = heard.hypothesis;
    known.revision = heard.revision;
    known.closed = heard.closed;
  }

  private render(): void {
    const stable = this.text(false);
    const guess = joined(this.ordered.filter((line) => !line.closed).map((line) => line.hypothesis));
    if (stable === this.current && guess === this.shown && this.delivered === stable) return;
    this.current = stable;
    this.shown = guess;
    if (this.target.show(stable, guess)) this.delivered = stable;
  }

  private text(hinted: boolean): string {
    return joined(this.ordered.flatMap((line) => (hinted ? [line.text, line.hint] : [line.text])));
  }

  private confirmed(): boolean {
    return this.phases.size > 0 && [...this.phases.values()].every((phase) => phase === 'finished') && this.gaps.length === 0;
  }

  private missing(ending: Ending): string[] {
    const unconfirmed = ending === 'end' && (this.phases.size === 0 || [...this.phases.values()].some((phase) => phase !== 'finished'));
    return unconfirmed ? [...this.gaps, 'the recognizer did not confirm the end of the speech'] : [...this.gaps];
  }
}

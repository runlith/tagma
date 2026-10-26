import type { Gap, Heard as Spoken, TrackState, Utterance } from '@runlith/speech/wire/heard';
import type { GapLine, Heard, Line, Unit, UtteranceLine } from '../contract/wire/listening.js';

export type Voice = { readonly track: string; readonly segment: number; readonly speaker: string };

const utteranceKeyOf = (track: string, segment: number, seq: number): string => `u/${track}/${segment}/${seq}`;

export const utteranceKey = (utterance: Utterance, base: number): string =>
  utteranceKeyOf(utterance.id.track, utterance.id.segment + base, utterance.id.seq);

export const keyOf = (line: Line): string => {
  switch (line.kind) {
    case 'utterance':
      return utteranceKeyOf(line.track, line.segment, line.seq);
    case 'gap':
      return `g/${line.change}`;
    case 'mute':
      return `m/${line.track}/${line.from}`;
    case 'mark':
      return `k/${line.born}`;
  }
};

export const markKey = (born: number): string => `k/${born}`;

export const voiceKey = (voice: Voice): string => `${voice.track}/${voice.segment}/${voice.speaker}`;

export const voiceOf = (utterance: Utterance, base: number, separating: boolean): Voice =>
  separating
    ? { track: utterance.id.track, segment: utterance.id.segment + base, speaker: utterance.speaker ?? '' }
    : { track: utterance.id.track, segment: 0, speaker: '' };

const unitsOf = (utterance: Utterance): readonly Unit[] =>
  utterance.units.flatMap((unit): readonly Unit[] =>
    unit.lane !== 'source'
      ? []
      : [
          {
            text: unit.text,
            from: unit.time === undefined ? undefined : unit.time.from,
            to: unit.time === undefined ? undefined : unit.time.to,
            language: unit.language,
          },
        ],
  );

export const stableOf = (utterance: Utterance): string => {
  let units = 0;
  for (const unit of utterance.units) if (unit.lane === 'source') units += 1;
  return `${utterance.closed ? 1 : 0}|${utterance.span?.from ?? ''}|${utterance.span?.to ?? ''}|${utterance.speaker ?? ''}|${units}|${utterance.text}`;
};

export const utteranceLine = (utterance: Utterance, change: number, base: number, speaker: number | null): UtteranceLine => ({
  kind: 'utterance',
  change,
  track: utterance.id.track,
  segment: utterance.id.segment + base,
  seq: utterance.id.seq,
  revision: utterance.revision,
  closed: utterance.closed,
  text: utterance.text,
  from: utterance.span?.from ?? null,
  to: utterance.span?.to ?? null,
  speaker,
  units: unitsOf(utterance),
});

export const gapLine = (gap: Gap, change: number): GapLine => ({
  kind: 'gap',
  change,
  track: gap.track,
  from: gap.from,
  to: gap.to ?? null,
  cause: gap.cause,
  message: gap.message,
});

const stateOf = (state: TrackState): Heard => ({
  kind: 'track',
  track: state.track,
  phase: state.phase,
  queuedMs: state.queuedMs,
  retryInMs: state.retryInMs ?? null,
  reason: null,
});

export const heardOf = (spoken: Exclude<Spoken, { readonly _tag: 'Finished' }>, base: number, speaker: number | null): Heard => {
  switch (spoken._tag) {
    case 'Utterance':
      return {
        kind: 'utterance',
        track: spoken.id.track,
        segment: spoken.id.segment + base,
        seq: spoken.id.seq,
        revision: spoken.revision,
        closed: spoken.closed,
        text: spoken.text,
        hypothesis: spoken.hypothesis,
        from: spoken.span?.from ?? null,
        to: spoken.span?.to ?? null,
        speaker,
      };
    case 'Gap':
      return { kind: 'gap', track: spoken.track, from: spoken.from, to: spoken.to ?? null, cause: spoken.cause, message: spoken.message };
    case 'State':
      return stateOf(spoken);
  }
};

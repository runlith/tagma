import type { Heard as Spoken, TrackState, Utterance } from '@runlith/speech/wire/heard';
import type { Heard } from '../contract/wire/listening.js';

export type Voice = { readonly track: string; readonly segment: number; readonly speaker: string };

export const voiceKey = (voice: Voice): string => `${voice.track}/${voice.segment}/${voice.speaker}`;

export const voiceOf = (utterance: Utterance, base: number, separating: boolean): Voice =>
  separating
    ? { track: utterance.id.track, segment: utterance.id.segment + base, speaker: utterance.speaker ?? '' }
    : { track: utterance.id.track, segment: 0, speaker: '' };

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

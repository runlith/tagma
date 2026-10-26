import type { Fate } from './methods/declaration.js';
import type { OpenedTurn } from './row.js';
import type { HarnessTurnBegun } from './turns.js';

export const begunOf = (turn: OpenedTurn, inputs: readonly string[]): HarnessTurnBegun => ({
  turn: turn.id,
  inputs,
  words: turn.words,
  at: turn.startedAt,
  noted: turn.noted,
});

export const unsaidNotes = (turns: readonly OpenedTurn[], fate: Fate): Fate =>
  fate._tag === 'Acknowledged' || fate.noted !== undefined
    ? fate
    : { ...fate, noted: turns.find((turn) => turn.id === fate.turn && turn.words === '')?.noted };

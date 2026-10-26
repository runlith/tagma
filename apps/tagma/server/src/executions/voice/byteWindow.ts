import { UNVOICED } from '../../platform/contract/service/presentation.js';
import { windowText } from '../contract/wire/bytes.js';
import type { TerminalBytesReading } from '../contract/wire/operationAnswers.js';
import { type Answered, refWords, typedLines } from './execution.js';

type Window = typeof TerminalBytesReading.Type;

function* windowLines(window: Window): Generator<string> {
  const { range, positions } = window;
  const { cursor } = range;
  yield `${refWords(cursor.ref)} ${cursor.stream}: bytes ${cursor.offset}–${range.next}, next offset ${range.next}`;
  yield `retained ${range.retainedFrom}–${range.durableThrough}${
    range.gap ? `; a gap: what stood before ${range.retainedFrom} is no longer kept, so this window starts past it` : ''
  }`;
  if (positions !== undefined) {
    yield `${positions.stream} now: retained ${positions.retainedFrom}–${positions.durableThrough}, parsed through ${positions.parsedThrough}, ${positions.ending}`;
  }
  if (range.grid !== undefined) yield `grid ${range.grid.columns}×${range.grid.rows}`;
  yield* typedLines(window.typedBy);
  const text = windowText(window.bytes);
  yield '';
  if (text.length === 0) yield '(no bytes in this window)';
  else yield* text;
}

export const windowVoice = (answer: Answered<Window>) => (answer.status === 'ok' ? windowLines(answer) : UNVOICED);

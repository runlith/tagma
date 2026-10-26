import type { PatchSpan } from './patch.js';
import {
  type Change,
  type Deadline,
  type Sequence,
  type Span,
  OUTSIDE,
  empty,
  joined,
  myersAlignment,
  optimized,
  scoredAlignment,
  spread,
} from './sequenceDiff.js';

const PATCH_SCORED_CHARS = 500;

const JOIN_NEAR_CHARS = 2;

const WORD_EQUAL_SHARE = 2 / 3;

const PATCH_SPAN_LINE_CHARS = 600;

const CHAR_LOWER = 0;
const CHAR_UPPER = 1;
const CHAR_DIGIT = 2;
const CHAR_END = 3;
const CHAR_OTHER = 4;
const CHAR_SEPARATOR = 5;
const CHAR_SPACE = 6;
const CHAR_SCORE = [0, 0, 0, 10, 2, 30, 3];

type CharSequence = Sequence & { readonly lead: number; word(offset: number): Span | null };

export function spansOf(
  before: string,
  after: string,
  deadline: Deadline,
): { readonly before: readonly PatchSpan[]; readonly after: readonly PatchSpan[]; readonly timedOut: boolean } {
  if (before.length > PATCH_SPAN_LINE_CHARS || after.length > PATCH_SPAN_LINE_CHARS) {
    return { before: [], after: [], timedOut: false };
  }
  const one = charSequence(before);
  const two = charSequence(after);
  const aligned = one.length + two.length < PATCH_SCORED_CHARS ? scoredAlignment(one, two, deadline) : myersAlignment(one, two, deadline);
  if (aligned.timedOut) return { before: [], after: [], timedOut: true };
  const refined = joinedOverNearGaps(extendedToWords(one, two, optimized(one, two, aligned.changes)));
  return {
    before: refined.map((change) => ({ start: change.before.start + one.lead, end: change.before.end + one.lead })),
    after: refined.map((change) => ({ start: change.after.start + two.lead, end: change.after.end + two.lead })),
    timedOut: false,
  };
}

function charSequence(line: string): CharSequence {
  const text = line.trim();
  const at = (offset: number): string => (offset >= 0 && offset < text.length ? (text[offset] as string) : '');
  return {
    length: text.length,
    lead: line.length - line.trimStart().length,
    element: (offset) => (offset >= 0 && offset < text.length ? text.charCodeAt(offset) : OUTSIDE),
    stronglyEqual: (offset1, offset2) => at(offset1) === at(offset2),
    boundaryScore: (offset) => {
      const previous = charCategory(at(offset - 1));
      const next = charCategory(at(offset));
      const apart = previous === next ? 0 : previous === CHAR_LOWER && next === CHAR_UPPER ? 11 : 10;
      return apart + (CHAR_SCORE[previous] as number) + (CHAR_SCORE[next] as number);
    },
    word: (offset) => {
      if (!wordChar(at(offset))) return null;
      let start = offset;
      while (start > 0 && wordChar(at(start - 1))) start -= 1;
      let end = offset;
      while (end < text.length && wordChar(at(end))) end += 1;
      return { start, end };
    },
  };
}

function charCategory(char: string): number {
  if (char === ' ' || char === '\t') return CHAR_SPACE;
  if (char >= 'a' && char <= 'z') return CHAR_LOWER;
  if (char >= 'A' && char <= 'Z') return CHAR_UPPER;
  if (char >= '0' && char <= '9') return CHAR_DIGIT;
  if (char === '') return CHAR_END;
  if (char === ',' || char === ';') return CHAR_SEPARATOR;
  return CHAR_OTHER;
}

function wordChar(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9');
}

function extendedToWords(first: CharSequence, second: CharSequence, changes: readonly Change[]): readonly Change[] {
  const equals = inverted(changes, first.length);
  const extra: Change[] = [];
  let lastBefore = 0;
  let lastAfter = 0;
  const scanWord = (atBefore: number, atAfter: number, equal: Change): void => {
    if (atBefore < lastBefore || atAfter < lastAfter) return;
    const oneWord = first.word(atBefore);
    const twoWord = second.word(atAfter);
    if (oneWord === null || twoWord === null) return;
    let word: Change = { before: oneWord, after: twoWord };
    const part = intersected(word, equal);
    if (part === null) return;
    let equalBefore = part.before.end - part.before.start;
    let equalAfter = part.after.end - part.after.start;
    while (equals.length > 0) {
      const next = equals[0] as Change;
      if (!overlaps(next.before, word.before) && !overlaps(next.after, word.after)) break;
      const nextOne = first.word(next.before.start);
      const nextTwo = second.word(next.after.start);
      if (nextOne === null || nextTwo === null) break;
      const other: Change = { before: nextOne, after: nextTwo };
      const inner = intersected(other, next);
      if (inner !== null) {
        equalBefore += inner.before.end - inner.before.start;
        equalAfter += inner.after.end - inner.after.start;
      }
      word = joined(word, other);
      if (word.before.end < next.before.end) break;
      equals.shift();
    }
    if (equalBefore + equalAfter < spread(word) * WORD_EQUAL_SHARE) extra.push(word);
    lastBefore = word.before.end;
    lastAfter = word.after.end;
  };
  while (equals.length > 0) {
    const next = equals.shift() as Change;
    if (empty(next.before)) continue;
    scanWord(next.before.start, next.after.start, next);
    scanWord(next.before.end - 1, next.after.end - 1, next);
  }
  return mergedChanges([...changes], extra);
}

function inverted(changes: readonly Change[], beforeLength: number): Change[] {
  const equals: Change[] = [];
  for (let at = 0; at <= changes.length; at += 1) {
    const left = at === 0 ? undefined : (changes[at - 1] as Change);
    const right = at === changes.length ? undefined : (changes[at] as Change);
    const startBefore = left ? left.before.end : 0;
    const startAfter = left ? left.after.end : 0;
    const endBefore = right ? right.before.start : beforeLength;
    const endAfter = right ? right.after.start : (left ? left.after.end - left.before.end : 0) + beforeLength;
    equals.push({ before: { start: startBefore, end: endBefore }, after: { start: startAfter, end: endAfter } });
  }
  return equals;
}

function mergedChanges(one: readonly Change[], two: readonly Change[]): Change[] {
  const result: Change[] = [];
  let atOne = 0;
  let atTwo = 0;
  while (atOne < one.length || atTwo < two.length) {
    const left = one[atOne];
    const right = two[atTwo];
    const takeLeft = left !== undefined && (right === undefined || left.before.start < right.before.start);
    const next = takeLeft ? (one[atOne] as Change) : (two[atTwo] as Change);
    if (takeLeft) atOne += 1;
    else atTwo += 1;
    const last = result[result.length - 1];
    if (last !== undefined && last.before.end >= next.before.start) result[result.length - 1] = joined(last, next);
    else result.push(next);
  }
  return result;
}

function joinedOverNearGaps(changes: readonly Change[]): readonly Change[] {
  const result: Change[] = [];
  for (const change of changes) {
    const last = result[result.length - 1];
    if (last === undefined) {
      result.push(change);
      continue;
    }
    const near = change.before.start - last.before.end <= JOIN_NEAR_CHARS || change.after.start - last.after.end <= JOIN_NEAR_CHARS;
    if (near) result[result.length - 1] = joined(last, change);
    else result.push(change);
  }
  return result;
}

function intersected(one: Change, two: Change): Change | null {
  const before = overlap(one.before, two.before);
  const after = overlap(one.after, two.after);
  return before !== null && after !== null ? { before, after } : null;
}

function overlap(one: Span, two: Span): Span | null {
  const start = Math.max(one.start, two.start);
  const end = Math.min(one.end, two.end);
  return start <= end ? { start, end } : null;
}

function overlaps(one: Span, two: Span): boolean {
  return Math.max(one.start, two.start) < Math.min(one.end, two.end);
}

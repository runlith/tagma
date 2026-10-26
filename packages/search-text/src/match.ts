export type Match = { readonly score: number; readonly positions: readonly number[] };

export type Near = { readonly distance: number; readonly positions: readonly number[] };

export type Scored = { readonly score: number; readonly positions: readonly number[]; readonly loose: boolean };

export type Target = {
  readonly name: string;
  readonly prose?: boolean;
  readonly names?: readonly (string | null | undefined)[];
  readonly text?: readonly (string | null | undefined)[];
};

export type Hit = Scored & { readonly exact: boolean };

export type Ranked<T> = { readonly item: T; readonly hit: Hit };

export type Piece = { readonly text: string; readonly hit: boolean };

type Field = { readonly text: string; readonly folded: string };

const ASCII = /^[\x00-\x7f]*$/;
const LATIN = /\p{Script=Latin}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const SPACE = /\s+/u;

const CONSECUTIVE = 6;
const WORD_START = 8;
const CASE_EXACT = 1;
const GAP = 0.5;
const GAP_CAP = 4;

const EXACT = 100;
const PREFIX = 90;
const WORD = 80;
const INITIALS = 75;
const SUBSTRING = 70;
const JOINED = 1;
const LOOSE = 25;
const LOOSE_SPAN = 34;
const NEAR_WEIGHT = 0.8;
const TEXT_WORD = 20;
const TEXT_WHOLE = 2;
const TEXT_SUBSTRING = 15;
const TEXT_SUBSTRING_FROM = 3;
const TEXT_TYPO = 10;
const PER_TYPO = 5;
const SPARE = 0.02;
const SPARE_CAP = 4;

const NOTHING: Hit = { score: 0, positions: [], loose: false, exact: false };

const high = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const low = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

export function fold(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase();
  let folded = '';
  for (let at = 0; at < text.length; at += 1) {
    if (high(text.charCodeAt(at)) && low(text.charCodeAt(at + 1))) {
      const pair = text.slice(at, at + 2);
      const lower = pair.toLowerCase();
      folded += lower.length === 2 ? lower : pair;
      at += 1;
      continue;
    }
    const lower = (text[at] as string).toLowerCase()[0] as string;
    folded += lower === 'ё' ? 'е' : lower === 'ς' ? 'σ' : LATIN.test(lower) ? (lower.normalize('NFD')[0] as string) : lower;
  }
  return folded;
}

export function terms(query: string): readonly string[] {
  return fold(query.normalize('NFC'))
    .split(SPACE)
    .filter((term) => term !== '');
}

const letters = (text: string): number => {
  let count = 0;
  for (let at = 0; at < text.length; at += 1) if (!low(text.charCodeAt(at))) count += 1;
  return count;
};

const lowerCode = (code: number): boolean => code >= 0x61 && code <= 0x7a;
const upperCode = (code: number): boolean => code >= 0x41 && code <= 0x5a;

const wordAt = (text: string, at: number): boolean => {
  const code = text.charCodeAt(at);
  if (code < 0x80) return (code >= 0x30 && code <= 0x39) || upperCode(code) || lowerCode(code);
  return code === code && LETTER_OR_DIGIT.test(text[at] as string);
};

const wordChar = (unit: string | undefined): boolean => unit !== undefined && wordAt(unit, 0);

export function boundary(text: string, at: number): boolean {
  if (!wordAt(text, at)) return false;
  if (at === 0 || !wordAt(text, at - 1)) return true;
  const before = text.charCodeAt(at - 1);
  const here = text.charCodeAt(at);
  if (before < 0x80 && here < 0x80) return lowerCode(before) && upperCode(here);
  const unit = text[at] as string;
  if (UNSPACED.test(unit)) return true;
  const prior = text[at - 1] as string;
  return prior === prior.toLowerCase() && prior !== prior.toUpperCase() && unit !== unit.toLowerCase();
}

const subsequence = (needle: string, folded: string, from: number): boolean => {
  let at = from;
  for (let index = 0; index < needle.length; index += 1) {
    const step = high(needle.charCodeAt(index)) && low(needle.charCodeAt(index + 1)) ? 2 : 1;
    at = folded.indexOf(needle.slice(index, index + step), at);
    if (at === -1) return false;
    at += step;
    index += step - 1;
  }
  return true;
};

export function fuzzy(needle: string, text: string, folded: string, from = 0): Match | null {
  if (needle === '') return { score: 0, positions: [] };
  if (!subsequence(needle, folded, from)) return null;
  const width = text.length - from;
  const rows = needle.length;
  const score = new Float64Array(rows * width).fill(Number.NEGATIVE_INFINITY);
  const parent = new Int32Array(rows * width).fill(-1);
  for (let row = 0; row < rows; row += 1) {
    const paired = row > 0 && low(needle.charCodeAt(row)) && high(needle.charCodeAt(row - 1));
    let slid = Number.NEGATIVE_INFINITY;
    let slidAt = -1;
    for (let column = 0; column < width; column += 1) {
      if (row > 0 && column >= 2 && !paired) {
        const prior = score[(row - 1) * width + (column - 2)] as number;
        if (prior > Number.NEGATIVE_INFINITY && prior + GAP * (column - 2) > slid) {
          slid = prior + GAP * (column - 2);
          slidAt = column - 2;
        }
      }
      if (folded[from + column] !== needle[row]) continue;
      const gain = 1 + (boundary(text, from + column) ? WORD_START : 0) + (text[from + column] === needle[row] ? CASE_EXACT : 0);
      if (row === 0) {
        score[column] = gain - GAP * Math.min(GAP_CAP, column);
        continue;
      }
      let best = Number.NEGATIVE_INFINITY;
      let came = -1;
      const adjacent = column >= 1 ? (score[(row - 1) * width + (column - 1)] as number) : Number.NEGATIVE_INFINITY;
      if (adjacent > Number.NEGATIVE_INFINITY) {
        best = adjacent + CONSECUTIVE;
        came = column - 1;
      }
      if (slidAt >= 0 && slid - GAP * (column - 1) > best) {
        best = slid - GAP * (column - 1);
        came = slidAt;
      }
      if (came === -1) continue;
      score[row * width + column] = best + gain;
      parent[row * width + column] = came;
    }
  }
  let end = -1;
  let top = Number.NEGATIVE_INFINITY;
  for (let column = 0; column < width; column += 1) {
    const value = score[(rows - 1) * width + column] as number;
    if (value > top) {
      top = value;
      end = column;
    }
  }
  if (end === -1) return null;
  const positions = new Array<number>(rows);
  let column = end;
  for (let row = rows - 1; row >= 0; row -= 1) {
    positions[row] = from + column;
    column = parent[row * width + column] as number;
  }
  return { score: top, positions };
}

export function typos(length: number): number {
  return length >= 8 ? 2 : length >= 4 ? 1 : 0;
}

let grid = new Uint16Array(512);

function align(needle: string, folded: string, start: number, end: number, limit: number, whole = false): Near | null {
  if (limit < 0) return null;
  const rows = needle.length + 1;
  const columns = end - start + 1;
  if (grid.length < rows * columns) grid = new Uint16Array(rows * columns * 2);
  const cost = grid;
  for (let column = 0; column < columns; column += 1) cost[column] = column;
  for (let row = 1; row < rows; row += 1) {
    const base = row * columns;
    const wanted = needle.charCodeAt(row - 1);
    const previous = row > 1 ? needle.charCodeAt(row - 2) : -1;
    cost[base] = row;
    let least = row;
    for (let column = 1; column < columns; column += 1) {
      const seen = folded.charCodeAt(start + column - 1);
      let value = Math.min(
        cost[base - columns + column]! + 1,
        cost[base + column - 1]! + 1,
        cost[base - columns + column - 1]! + (wanted === seen ? 0 : 1),
      );
      if (column > 1 && previous === seen && wanted === folded.charCodeAt(start + column - 2)) {
        value = Math.min(value, cost[base - 2 * columns + column - 2]! + 1);
      }
      cost[base + column] = value;
      if (value < least) least = value;
    }
    if (least > limit) return null;
  }
  const last = (rows - 1) * columns;
  let reach = whole ? columns - 1 : 0;
  if (!whole) for (let column = 1; column < columns; column += 1) if (cost[last + column]! < cost[last + reach]!) reach = column;
  const distance = cost[last + reach]!;
  if (distance > limit) return null;
  const positions: number[] = [];
  let row = rows - 1;
  let column = reach;
  while (row > 0 && column > 0) {
    const here = cost[row * columns + column]!;
    const wanted = needle.charCodeAt(row - 1);
    const seen = folded.charCodeAt(start + column - 1);
    if (wanted === seen && here === cost[(row - 1) * columns + column - 1]!) {
      positions.push(start + column - 1);
      row -= 1;
      column -= 1;
    } else if (
      row > 1 &&
      column > 1 &&
      wanted === folded.charCodeAt(start + column - 2) &&
      needle.charCodeAt(row - 2) === seen &&
      here === cost[(row - 2) * columns + column - 2]! + 1
    ) {
      positions.push(start + column - 1, start + column - 2);
      row -= 2;
      column -= 2;
    } else if (here === cost[(row - 1) * columns + column - 1]! + 1) {
      row -= 1;
      column -= 1;
    } else if (here === cost[(row - 1) * columns + column]! + 1) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return { distance, positions: positions.reverse() };
}

export function distance(left: string, right: string, limit: number): number | null {
  if (Math.abs(left.length - right.length) > limit) return null;
  return align(left, right, 0, right.length, limit, true)?.distance ?? null;
}

let counted = '';
let counts: readonly (readonly [string, number])[] = [];

const countsOf = (needle: string): readonly (readonly [string, number])[] => {
  if (needle === counted) return counts;
  const tally = new Map<string, number>();
  for (let index = 0; index < needle.length; index += 1) tally.set(needle[index] as string, (tally.get(needle[index] as string) ?? 0) + 1);
  counted = needle;
  counts = [...tally];
  return counts;
};

function lacking(needle: string, folded: string, from: number, to: number, allowed: number): boolean {
  let missing = 0;
  for (const [unit, count] of countsOf(needle)) {
    let wanted = count;
    for (let at = folded.indexOf(unit, from); at !== -1 && at < to && wanted > 0; at = folded.indexOf(unit, at + 1)) wanted -= 1;
    missing += wanted;
    if (missing > allowed) return true;
  }
  return false;
}

export function near(needle: string, text: string, folded: string, from = 0, to = folded.length): Near | null {
  const allowed = typos(letters(needle));
  if (allowed === 0) return null;
  if (lacking(needle, folded, from, to, allowed)) return null;
  let best: Near | null = null;
  for (let start = from; start < to; start += 1) {
    if (!boundary(text, start)) continue;
    const found = align(needle, folded, start, Math.min(to, start + needle.length + allowed), best === null ? allowed : best.distance - 1);
    if (found === null) continue;
    best = found;
    if (found.distance === 0) break;
  }
  return best;
}

const ideal = (length: number): number => length * (1 + WORD_START + CASE_EXACT) + (length - 1) * CONSECUTIVE;

export function typoScore(distance: number, length: number): number {
  return ideal(length) * NEAR_WEIGHT * (1 - distance / length);
}

const span = (from: number, length: number): number[] => Array.from({ length }, (_, at) => from + at);

const loosely = (score: number, length: number): number => LOOSE + LOOSE_SPAN * Math.max(0, Math.min(1, score / ideal(length)));

let stripped = '';
let strippedWords = '';

const wordsOnly = (term: string): string => {
  if (term === stripped) return strippedWords;
  let wanted = '';
  for (let index = 0; index < term.length; index += 1) if (wordChar(term[index])) wanted += term[index];
  stripped = term;
  strippedWords = wanted;
  return wanted;
};

function joined(wanted: string, text: string, folded: string): Scored | null {
  const first = wanted.charCodeAt(0);
  for (let start = folded.indexOf(wanted[0] as string); start !== -1; start = folded.indexOf(wanted[0] as string, start + 1)) {
    if (start !== 0 && !boundary(text, start)) continue;
    const positions: number[] = [];
    let at = start;
    while (positions.length < wanted.length && at < folded.length) {
      if (!wordAt(folded, at)) {
        at += 1;
        continue;
      }
      if (folded.charCodeAt(at) !== wanted.charCodeAt(positions.length)) break;
      positions.push(at);
      at += 1;
    }
    if (positions.length === wanted.length && folded.charCodeAt(start) === first) {
      return { score: (start === 0 ? PREFIX : WORD) - JOINED, positions, loose: false };
    }
  }
  return null;
}

export function scoreName(term: string, text: string, folded: string, forgiving = true): Scored | null {
  if (folded === term) return { score: EXACT, positions: span(0, term.length), loose: false };
  const spare = (): number => {
    let count = 0;
    for (let at = 0; at < folded.length; at += 1) if (wordAt(folded, at)) count += 1;
    return Math.min(SPARE_CAP, Math.max(0, count - term.length) * SPARE);
  };
  if (folded.startsWith(term)) return { score: PREFIX - spare(), positions: span(0, term.length), loose: false };
  let inside = -1;
  for (let at = folded.indexOf(term, 1); at !== -1; at = folded.indexOf(term, at + 1)) {
    if (boundary(text, at)) return { score: WORD - spare(), positions: span(at, term.length), loose: false };
    if (inside === -1) inside = at;
  }
  const scattered = fuzzy(term, text, folded);
  const wanted = wordsOnly(term);
  if (wanted !== '' && (wanted === term ? scattered !== null : subsequence(wanted, folded, 0))) {
    const squeezed = joined(wanted, text, folded);
    if (squeezed !== null) return { ...squeezed, score: squeezed.score - spare() };
  }
  if (scattered !== null && scattered.positions.every((at) => boundary(text, at))) {
    return { score: INITIALS - spare(), positions: scattered.positions, loose: false };
  }
  if (inside !== -1) return { score: SUBSTRING - spare(), positions: span(inside, term.length), loose: false };
  const scatteredScore = scattered === null ? -1 : loosely(scattered.score, term.length);
  const typo = forgiving && scatteredScore < loosely(typoScore(1, term.length), term.length) ? near(term, text, folded) : null;
  const typoScored = typo === null ? -1 : loosely(typoScore(typo.distance, term.length), term.length);
  if (scattered !== null && scatteredScore >= typoScored) return { score: scatteredScore, positions: scattered.positions, loose: true };
  return typo === null ? null : { score: typoScored, positions: typo.positions, loose: true };
}

function worded(term: string, field: Field, anyLength: boolean): Scored | null {
  const { text, folded } = field;
  let inside = -1;
  for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
    if (boundary(text, at)) {
      return { score: TEXT_WORD + (wordChar(text[at + term.length]) ? 0 : TEXT_WHOLE), positions: span(at, term.length), loose: false };
    }
    if (inside === -1) inside = at;
  }
  if (inside !== -1 && (anyLength || letters(term) >= TEXT_SUBSTRING_FROM)) {
    return { score: TEXT_SUBSTRING, positions: span(inside, term.length), loose: false };
  }
  const typo = near(term, text, folded);
  return typo === null ? null : { score: TEXT_TYPO - PER_TYPO * (typo.distance - 1), positions: typo.positions, loose: true };
}

const fields = (texts: readonly (string | null | undefined)[] | undefined): readonly Field[] =>
  (texts ?? []).flatMap((text) => (text ? [{ text, folded: fold(text) }] : []));

const spoken = (folded: string): string =>
  folded
    .split(SPACE)
    .filter((word) => word !== '')
    .join(' ');

function scored(wanted: readonly string[], target: Target): Hit | null {
  const name: Field = { text: target.name, folded: fold(target.name) };
  const names = fields(target.names);
  const text = fields(target.text);
  let score = 0;
  let loose = false;
  const positions = new Set<number>();
  for (const term of wanted) {
    const own = target.prose ? worded(term, name, true) : scoreName(term, name.text, name.folded);
    let best = own;
    for (const field of names) {
      const found = scoreName(term, field.text, field.folded);
      if (found !== null && (best === null || found.score > best.score)) best = found;
    }
    if (best === null) {
      for (const field of text) {
        const found = worded(term, field, false);
        if (found !== null && (best === null || found.score > best.score)) best = found;
      }
    }
    if (best === null) return null;
    score += best.score;
    loose ||= best.loose;
    if (own !== null) for (const at of own.positions) positions.add(at);
  }
  const whole = wanted.join(' ');
  const exact = spoken(name.folded) === whole || names.some((field) => spoken(field.folded) === whole);
  return { score: score + (exact ? EXACT : 0), positions: [...positions].sort((left, right) => left - right), loose, exact };
}

export function match(query: string, target: Target): Hit | null {
  const wanted = terms(query);
  return wanted.length === 0 ? NOTHING : scored(wanted, target);
}

export function rank<T>(items: readonly T[], query: string, targetOf: (item: T) => Target): readonly Ranked<T>[] {
  const wanted = terms(query);
  if (wanted.length === 0) return items.map((item) => ({ item, hit: NOTHING }));
  const found: { readonly item: T; readonly hit: Hit; readonly index: number }[] = [];
  items.forEach((item, index) => {
    const hit = scored(wanted, targetOf(item));
    if (hit !== null) found.push({ item, hit, index });
  });
  return found.sort((left, right) => right.hit.score - left.hit.score || left.index - right.index).map(({ item, hit }) => ({ item, hit }));
}

export function byBest<G, T>(groups: readonly G[], ranked: readonly Ranked<T>[], holds: (group: G, item: T) => boolean): readonly G[] {
  const at = (group: G): number => {
    const index = ranked.findIndex(({ item }) => holds(group, item));
    return index === -1 ? ranked.length : index;
  };
  return groups
    .map((group) => ({ group, at: at(group) }))
    .sort((left, right) => left.at - right.at)
    .map(({ group }) => group);
}

export function pieces(text: string, positions: readonly number[], from = 0, to = text.length): readonly Piece[] {
  const hits = new Set<number>();
  for (const at of positions) {
    hits.add(at);
    if (high(text.charCodeAt(at)) && low(text.charCodeAt(at + 1))) hits.add(at + 1);
    if (low(text.charCodeAt(at)) && high(text.charCodeAt(at - 1))) hits.add(at - 1);
  }
  const out: Piece[] = [];
  for (let at = from; at < to; at += 1) {
    const hit = hits.has(at);
    const last = out.at(-1);
    if (last !== undefined && last.hit === hit) out[out.length - 1] = { text: last.text + (text[at] ?? ''), hit };
    else out.push({ text: text[at] ?? '', hit });
  }
  return out;
}

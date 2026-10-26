import { Effect, Schema } from 'effect';
import { handle } from '@runlith/utils/printed';

export type Cursor = string & { readonly __cursor: unique symbol };

export type PageQuestion = {
  readonly operation: string;
  readonly selection: Readonly<Record<string, unknown>>;
  readonly order: number;
};

export type PageKey = readonly (string | number | boolean | null)[];

export type PageCut = 'read-ceiling' | 'partial-walk' | 'unavailable';

export type Page<T, N extends number | null = number | null> = {
  readonly rows: readonly T[];
  readonly shown: number;
  readonly total: N;
  readonly next: Cursor | null;
  readonly complete: boolean;
  readonly reason?: PageCut;
};

export type PageRoad = 'text' | 'json';

export type PageFamily = {
  readonly id: string;
  readonly order: number;
  readonly rowBytes: { readonly text: number; readonly json: number };
  readonly road: PageRoad;
  readonly defaultRows: number | 'ceiling';
  readonly reserveBytes?: number;
  readonly sample: () => unknown;
};

export const family = (
  id: string,
  order: number,
  road: PageRoad,
  rowBytes: PageFamily['rowBytes'],
  defaultRows: PageFamily['defaultRows'],
  sample: () => unknown,
): PageFamily => ({ id, order, road, rowBytes, defaultRows, sample });

export const pageCeiling = (family: PageFamily, carrierBytes: number, carrierLines: number): number => {
  const weight = family.rowBytes[family.road];
  const byBytes = Math.floor((carrierBytes - FOOTER_RESERVE_BYTES - (family.reserveBytes ?? 0)) / Math.max(1, weight));
  return Math.max(1, Math.min(byBytes, carrierLines - FOOTER_RESERVE_LINES));
};

const FOOTER_RESERVE_BYTES = 512;
const FOOTER_RESERVE_LINES = 4;

export const pageLimit = (family: PageFamily, ceiling: number): Schema.optional<typeof Schema.Int> =>
  Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(ceiling)).annotate({
      description: `How many rows to answer, ${pageRows(undefined, family, ceiling)} by default and ${ceiling} at most for this reading. The answer carries the total and the cursor, so a cut is never silent.`,
    }),
  ) as Schema.optional<typeof Schema.Int>;

export const PageCursor = Schema.String.check(Schema.isMinLength(1)).annotate(handle());

export const PAGE_CURSOR = Schema.optional(
  PageCursor.annotate({
    description: 'The cursor the previous page answered, handed back unchanged.',
  }),
);

export const pageRows = (asked: number | undefined, family: PageFamily, ceiling: number): number =>
  Math.max(1, Math.min(asked ?? (family.defaultRows === 'ceiling' ? ceiling : family.defaultRows), ceiling));

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`).join(',')}}`;
};

export const questionOf = (question: PageQuestion): string => canonical([question.operation, question.order, question.selection]);

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const encodeCursor = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += `${CHARS[a >> 2] ?? ''}${CHARS[((a & 3) << 4) | ((b ?? 0) >> 4)] ?? ''}`;
    if (b === undefined) break;
    out += CHARS[((b & 15) << 2) | ((c ?? 0) >> 6)] ?? '';
    if (c === undefined) break;
    out += CHARS[c & 63] ?? '';
  }
  return out;
};

const decodeCursor = (cursor: string): string | null => {
  const bytes: number[] = [];
  let held = 0;
  let bits = 0;
  for (const glyph of cursor) {
    const value = CHARS.indexOf(glyph);
    if (value < 0) return null;
    held = (held << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((held >> bits) & 255);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
};

export const mintCursor = (question: PageQuestion, key: PageKey): Cursor => encodeCursor(canonical([questionOf(question), key])) as Cursor;

const isKeyPart = (part: unknown): boolean =>
  part === null || typeof part === 'string' || typeof part === 'boolean' || (typeof part === 'number' && Number.isFinite(part));

export type CursorReading = { readonly at: PageKey } | { readonly refused: 'bad-cursor' | 'cursor-stale' };

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const mintedOf = (cursor: unknown): { readonly asked: string; readonly at: PageKey } | null => {
  const decoded = typeof cursor === 'string' && cursor.length > 0 ? decodeCursor(cursor) : null;
  const parsed = decoded === null ? undefined : parsedJson(decoded);
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [asked, at] = parsed as readonly unknown[];
  if (typeof asked !== 'string' || !Array.isArray(at) || at.length === 0 || !at.every(isKeyPart)) return null;
  return { asked, at: at as PageKey };
};

export const readCursor = (cursor: unknown, question: PageQuestion): CursorReading => {
  const minted = mintedOf(cursor);
  if (minted === null) return { refused: 'bad-cursor' };
  return minted.asked === questionOf(question) ? { at: minted.at } : { refused: 'cursor-stale' };
};

const markOf = (text: string): string => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const OFFSET_CURSOR = /^([0-9a-z]+)\.(\d+)\.([0-9a-z]+)$/u;

export type OffsetCursor = { readonly at: number; readonly mark: string };

export type OffsetReading = OffsetCursor | { readonly refused: 'bad-cursor' | 'cursor-stale' };

export const readOffsetCursor = (cursor: unknown, question: PageQuestion): OffsetReading => {
  const parsed = typeof cursor === 'string' ? OFFSET_CURSOR.exec(cursor) : null;
  const at = parsed === null ? Number.NaN : Number(parsed[2]);
  if (parsed === null || !Number.isSafeInteger(at) || at < 1) return { refused: 'bad-cursor' };
  return parsed[1] === markOf(questionOf(question)) ? { at, mark: parsed[3] ?? '' } : { refused: 'cursor-stale' };
};

export const resumeOffset = <T>(rows: readonly T[], keyOf: (row: T) => string, cursor: OffsetCursor): number | null => {
  const last = rows[cursor.at - 1];
  return cursor.at < rows.length && last !== undefined && markOf(keyOf(last)) === cursor.mark ? cursor.at : null;
};

export type OffsetPage<T> = {
  readonly rows: readonly T[];
  readonly from: number;
  readonly next: Cursor | null;
};

export function offsetPage<T>(input: {
  readonly rows: readonly T[];
  readonly at: number;
  readonly asked: number;
  readonly question: PageQuestion;
  readonly keyOf: (row: T) => string;
}): OffsetPage<T> {
  const asked = Math.max(1, Math.floor(input.asked));
  const rows = input.rows.slice(input.at, input.at + asked);
  const end = input.at + rows.length;
  const last = rows[rows.length - 1];
  const next =
    end < input.rows.length && last !== undefined
      ? (`${markOf(questionOf(input.question))}.${end}.${markOf(input.keyOf(last))}` as Cursor)
      : null;
  return { rows, from: input.at, next };
}

export type PageDirection = 'asc' | 'desc';

const compareKeyPart = (left: PageKey[number], right: PageKey[number]): number => {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : 1;
};

export const keyOrder =
  (directions: readonly PageDirection[]) =>
  (left: PageKey, right: PageKey): number => {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const diff = compareKeyPart(left[index] ?? null, right[index] ?? null);
      if (diff !== 0) return directions[index] === 'desc' ? -Math.sign(diff) : Math.sign(diff);
    }
    return 0;
  };

export const pastKey = <T>(rows: readonly T[], keyOf: (row: T) => PageKey, directions: readonly PageDirection[], at: PageKey): T[] => {
  const order = keyOrder(directions);
  return rows.filter((row) => order(keyOf(row), at) > 0);
};

export type PageSelection = Readonly<Record<string, unknown>>;

export type PageWalk<S extends PageSelection, K extends PageKey = PageKey> = {
  readonly operation: string;
  readonly order: number;
  readonly selection: Schema.Decoder<S>;
  readonly key: Schema.Decoder<K>;
};

export const walkQuestion = <S extends PageSelection>(walk: PageWalk<S, PageKey>, selection: S): PageQuestion => ({
  operation: walk.operation,
  selection,
  order: walk.order,
});

export type CursorRefusal = 'bad-cursor' | 'cursor-stale';

export type SelectionReading<S> = { readonly selection: S } | { readonly refused: CursorRefusal };

export const recallSelection = <S extends PageSelection>(walk: PageWalk<S, PageKey>, cursor: unknown): SelectionReading<S> => {
  const minted = mintedOf(cursor);
  const asked = minted === null ? undefined : parsedJson(minted.asked);
  if (!Array.isArray(asked) || asked.length !== 3) return { refused: 'bad-cursor' };
  if (asked[0] !== walk.operation || asked[1] !== walk.order) return { refused: 'cursor-stale' };
  const selection = Schema.decodeUnknownOption(walk.selection)(asked[2]);
  return selection._tag === 'Some' ? { selection: selection.value } : { refused: 'bad-cursor' };
};

export const cursorSelection = (cursor: unknown, operation: string): Readonly<Record<string, unknown>> | null => {
  const minted = mintedOf(cursor);
  const asked = minted === null ? undefined : parsedJson(minted.asked);
  if (!Array.isArray(asked) || asked.length !== 3 || asked[0] !== operation) return null;
  const selection: unknown = asked[2];
  return typeof selection === 'object' && selection !== null && !Array.isArray(selection)
    ? (selection as Readonly<Record<string, unknown>>)
    : null;
};

export const carriedSelection = <S extends PageSelection>(walk: PageWalk<S, PageKey>, cursor: string | undefined): S | undefined => {
  const read = cursor === undefined ? undefined : recallSelection(walk, cursor);
  return read === undefined || 'refused' in read ? undefined : read.selection;
};

export type PageSlice<T, N extends number | null = number | null> = { readonly rows: readonly T[]; readonly total: N };

export type PageWalking<S extends PageSelection, K extends PageKey, T, N extends number | null, E, R> = {
  readonly walk: PageWalk<S, K>;
  readonly selection: S;
  readonly cursor: string | undefined;
  readonly asked: number;
  readonly keyOf: (row: T) => K;
  readonly read: (after: K | undefined, rows: number) => Effect.Effect<PageSlice<T, N>, E, R>;
};

export type PageResume<K extends PageKey> = { readonly question: PageQuestion; readonly after: K | undefined };

export const walking = <F>(refuse: (refused: CursorRefusal) => F) => {
  const resume = <S extends PageSelection, K extends PageKey>(
    walk: PageWalk<S, K>,
    selection: S,
    cursor: string | undefined,
  ): Effect.Effect<PageResume<K>, F> => {
    const question = walkQuestion(walk, selection);
    const continued = cursor === undefined ? undefined : readCursor(cursor, question);
    if (continued !== undefined && 'refused' in continued) return Effect.fail(refuse(continued.refused));
    const after = continued === undefined ? undefined : Schema.decodeUnknownOption(walk.key)(continued.at);
    if (after?._tag === 'None') return Effect.fail(refuse('bad-cursor'));
    return Effect.succeed({ question, after: after?.value });
  };
  return {
    recall: <S extends PageSelection>(walk: PageWalk<S, PageKey>, cursor: string): Effect.Effect<S, F> => {
      const read = recallSelection(walk, cursor);
      return 'refused' in read ? Effect.fail(refuse(read.refused)) : Effect.succeed(read.selection);
    },
    resume,
    page: <S extends PageSelection, K extends PageKey, T, N extends number | null, E, R>(
      input: PageWalking<S, K, T, N, E, R>,
    ): Effect.Effect<Page<T, N>, E | F, R> => {
      const asked = Math.max(1, Math.floor(input.asked));
      return Effect.flatMap(resume(input.walk, input.selection, input.cursor), (resumed) =>
        Effect.map(input.read(resumed.after, asked + 1), (slice) =>
          page({ rows: slice.rows, asked, keyOf: input.keyOf, question: resumed.question, total: slice.total }),
        ),
      );
    },
  };
};

export const heldRows =
  <T, K extends PageKey>(rows: readonly T[], keyOf: (row: T) => K, directions: readonly PageDirection[]) =>
  (after: K | undefined, count: number): Effect.Effect<PageSlice<T, number>> =>
    Effect.succeed({ rows: (after === undefined ? rows : pastKey(rows, keyOf, directions, after)).slice(0, count), total: rows.length });

export function page<T, N extends number | null = number | null>(input: {
  readonly rows: readonly T[];
  readonly asked: number;
  readonly keyOf: (row: T) => PageKey;
  readonly question: PageQuestion;
  readonly total: N;
  readonly complete?: boolean;
  readonly reason?: PageCut;
}): Page<T, N> {
  const asked = Math.max(1, Math.floor(input.asked));
  const carried = input.rows.slice(0, asked);
  const more = input.rows.length > asked;
  const last = carried[carried.length - 1];
  const next = more && last !== undefined ? mintCursor(input.question, input.keyOf(last)) : null;
  const complete = input.reason === undefined && (input.complete ?? true);
  return {
    rows: carried,
    shown: carried.length,
    total: input.total,
    next,
    complete,
    reason: input.reason,
  };
}

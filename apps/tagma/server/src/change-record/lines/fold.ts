import type { Deadline } from '@runlith/utils/sequenceDiff';
import {
  appendWork,
  digestOf,
  startFold,
  workingWork,
  type CachedFold,
  type Content,
  type FoldRow,
  type FoldState,
  type Unknown,
} from './folding.js';
import { lookup, type Writer } from './marks.js';
import type { Landed } from './landed.js';
import { projectWork, summarize, type BaseAlignment, type FormedLine, type Proven, type Verdict } from './projection.js';
import { completeFold, type FoldWork } from './jobs.js';
import { formedLines, type Debt } from './owed.js';
import type { FoldEvidence } from './evidence.js';

export type FoldInput = {
  readonly base: Content;
  readonly head: Content;
  readonly working: Content;
  readonly rows: readonly FoldRow[];
  readonly normalized: boolean;
  readonly partial?: boolean;
  readonly formed?: readonly FormedLine[];
  readonly debts?: readonly Debt[];
  readonly evidence?: FoldEvidence;
  readonly landed?: readonly Landed[];
  readonly ended?: ReadonlySet<string>;
};
type Folded = {
  readonly record: FoldState | null;
  readonly working: FoldState | null;
  readonly result: Verdict;
  readonly alignment: BaseAlignment | null;
};

function knownRows(input: FoldInput, state?: FoldState): readonly FoldRow[] {
  const previous: FoldRow[] = [];
  for (let link = state?.rows; link != null; link = link.previous) previous.push(link.row);
  const rows = new Map(previous.reverse().map((row) => [row.id, row]));
  for (const row of input.rows) rows.set(row.id, row);
  return [...rows.values()];
}

const standing = (input: FoldInput, rows: readonly FoldRow[]): readonly FoldRow[] =>
  input.ended === undefined ? rows : rows.filter((row) => !input.ended!.has(row.id));

const lastAt = (input: FoldInput, rows: readonly FoldRow[]): number => {
  const latest = new Map<string, FoldRow>();
  for (const row of rows) latest.set(row.holder, row);
  let last = -1;
  for (const [at, row] of rows.entries()) if (latest.get(row.holder) === row && digestOf(row.after) === digestOf(input.working)) last = at;
  return last;
};

const CLEAN: Proven = { ...summarize([], [], null, new Map()), lines: 'unweighed', counts: 'unweighed' };

const unweighed = (chain: readonly FoldRow[]): Proven => {
  const end = chain[chain.length - 1];
  const proven = summarize([], [], end === undefined ? 'external' : { row: end.id, holder: end.holder }, new Map());
  const hands = new Map(chain.map((row) => [row.holder, { holder: row.holder, added: 0, removed: 0 }] as const));
  return { ...proven, hands: [...hands.values()], standing: new Set(chain.map((row) => row.id)), lines: 'unweighed', counts: 'unweighed' };
};

export function lastWriter(input: FoldInput): Proven {
  if (digestOf(input.head) === digestOf(input.working)) return CLEAN;
  const rows = standing(input, input.rows);
  const last = rows[lastAt(input, rows)];
  return unweighed(last === undefined ? [] : [last]);
}

export function wholeFile(input: FoldInput, rows: readonly FoldRow[] = input.rows): Proven {
  if (digestOf(input.head) === digestOf(input.working)) return CLEAN;
  const last = lastAt(input, rows);
  const chain: FoldRow[] = [];
  let wanted: Content | undefined = rows[last]?.after;
  for (let at = last; at >= 0 && wanted !== undefined && !sameVersion(wanted, input.head); at -= 1) {
    const row = rows[at] as FoldRow;
    if (!sameVersion(row.after, wanted)) continue;
    chain.push(row);
    wanted = row.before;
  }
  return unweighed(standing(input, chain.reverse()));
}

const sameVersion = (one: Content, other: Content): boolean =>
  one.kind === 'absent' || other.kind === 'absent' ? one.kind === other.kind : digestOf(one) != null && digestOf(one) === digestOf(other);

export function foldPath(input: FoldInput, budget: Deadline, cached?: CachedFold, alignment?: BaseAlignment): Folded {
  return completeFold(foldWork(input, budget, cached, alignment), budget);
}
function* foldWork(input: FoldInput, budget: Deadline, cached?: CachedFold, alignment?: BaseAlignment): FoldWork<Folded> {
  const unknown = (reason: Unknown, row?: string): Folded => ({
    record: null,
    working: null,
    alignment: null,
    result: {
      verdict: 'unknown',
      ...(reason.reason === 'opaque' ? { ...reason, row: reason.row ?? row } : reason),
      writers: standing(input, knownRows(input, cached?.state)).map((row): Writer => ({ row: row.id, holder: row.holder })),
    },
  });
  if (input.head.kind === 'unread') return unknown({ reason: 'unread', side: 'head', cause: input.head.cause });
  if (input.working.kind === 'unread') return unknown({ reason: 'unread', side: 'working', cause: input.working.cause });
  if (cached !== undefined && (cached.state.normalized !== input.normalized || digestOf(cached.state.base) !== digestOf(input.base)))
    return unknown({ reason: 'alignment' });
  if (cached?.kind === 'after' && cached.row !== cached.state.last)
    return unknown({ reason: 'sequence', expected: cached.state.last, received: cached.row });
  if (input.head.kind === 'whole' || input.working.kind === 'whole')
    return { record: null, working: null, alignment: null, result: wholeFile(input, knownRows(input, cached?.state)) };
  const initial = cached?.state ?? startFold(input.base, input.normalized);
  if ('reason' in initial)
    return digestOf(input.head) === digestOf(input.working)
      ? { record: null, working: null, alignment: null, result: summarize([], [], null, new Map()) }
      : unknown(initial, input.rows[0]?.id);
  let record = initial;
  let cursor = cached?.kind === 'after' ? cached.row : null;
  for (let at = 0; at < input.rows.length; at += 1) {
    const row = input.rows[at] as FoldRow;
    const previous = lookup(record.records, row.id);
    if (previous !== undefined) {
      if (cached?.kind === 'complete') {
        if (previous !== cursor) return unknown({ reason: 'sequence', expected: previous, received: cursor });
        cursor = row.id;
      }
      continue;
    }
    if (cursor !== record.last) return unknown({ reason: 'sequence', expected: record.last, received: cursor });
    const stepped = yield* appendWork(record, row, budget, input.rows[at + 1]?.before ?? input.working, input.partial === true);
    if ('reason' in stepped)
      return digestOf(input.head) === digestOf(input.working)
        ? { record: null, working: null, alignment: null, result: summarize([], [], null, new Map()) }
        : unknown(stepped, row.id);
    record = stepped;
    cursor = row.id;
  }
  if (cached?.kind === 'complete' && cursor !== record.last)
    return unknown({ reason: 'sequence', expected: record.last, received: cursor });
  const working = yield* workingWork(record, input.working);
  if ('reason' in working) return unknown(working);
  const { result, alignment: aligned } = yield* projectWork(
    working,
    input.head,
    input.working,
    budget,
    alignment,
    input.formed ?? formedLines(input.debts ?? []),
    input.landed,
    input.ended,
  );
  return result.verdict === 'unknown'
    ? { record: null, working: null, alignment: aligned, result }
    : { record, working, alignment: aligned, result };
}

import { Data } from 'effect';
import { utf8Order } from '@runlith/utils/utf8';
import type { ActivityLoss } from '@runlith/activity/fact';
import type { ThreadEventPayload } from './events';
import { threadEventPayloadSchema } from './persisted';
import { THREAD_QUERY_FIELDS, type ThreadQueryOp, type ThreadQuerySource } from '../protocol/threadQuery';

export type ThreadKernelSource = Exclude<ThreadQuerySource, 'activity'>;

export type ThreadQueryLiteral = string | number | boolean | null;

export type ThreadQueryPredicate = {
  readonly field: string;
  readonly op: ThreadQueryOp;
  readonly value?: ThreadQueryLiteral | readonly ThreadQueryLiteral[];
};

export type ThreadQueryOrder = { readonly by: string; readonly dir: 'asc' | 'desc' };

export type ThreadQuery = {
  readonly select: ThreadQuerySource;
  readonly where?: readonly ThreadQueryPredicate[];
  readonly fields?: readonly string[];
  readonly group?: readonly string[];
  readonly count?: boolean;
  readonly sum?: readonly string[];
  readonly order?: ThreadQueryOrder;
  readonly limit?: number;
};

export type ThreadQueryRow = { readonly [field: string]: unknown };

export type ThreadQueryGroup = {
  readonly by: Readonly<Record<string, unknown>>;
  readonly absent?: readonly string[];
  readonly count?: number;
  readonly sum?: Readonly<Record<string, number>>;
  readonly unknown?: Readonly<Record<string, number>>;
};

export type ThreadQueryCoverage = {
  readonly complete: boolean;
  readonly unavailable: readonly string[];
  readonly truncated: boolean;
  readonly read: number;
  readonly cut?: 'read-ceiling';
  readonly lost?: readonly ActivityLoss[];
};

export const THREAD_QUERY_DEFAULT_FIELDS: Record<ThreadQuerySource, readonly string[]> = {
  runs: [
    'threadId',
    'runId',
    'status',
    'provider',
    'model',
    'reasoning',
    'usage',
    'startedAt',
    'finishedAt',
    'settledNotifyAttempts',
    'settledNotifiedAt',
    'asOf',
  ],
  steps: ['threadId', 'at', 'runId', 'stepNumber', 'provider', 'model', 'usage', 'measuredAt'],
  measurements: ['threadId', 'at', 'runId', 'stepNumber', 'attempt', 'provider', 'model', 'usage', 'measuredAt'],
  entries: [
    'threadId',
    'at',
    'identity',
    'kind',
    'runId',
    'origin',
    'provider',
    'model',
    'occurredAt',
    'toolName',
    'toolCallId',
    'toolState',
    'failed',
  ],
  records: ['threadId', 'at', 'id', 'kind', 'origin'],
  activity: [
    'threadId',
    'at',
    'kind',
    'parent',
    'runId',
    'actor',
    'outcome',
    'reason',
    'provider',
    'model',
    'usage',
    'openedAt',
    'durationMs',
  ],
};

export class ThreadQueryFieldUnknown extends Data.TaggedError('ThreadQueryFieldUnknown')<{
  readonly message: string;
  readonly field: string;
  readonly source: ThreadQuerySource;
  readonly declared: readonly string[];
}> {
  constructor(source: ThreadQuerySource, field: string) {
    const declared = THREAD_QUERY_FIELDS[source];
    super({ message: `${source} has no field ${rootOf(field)}; it carries ${declared.join(', ')}.`, field, source, declared });
    this.name = 'ThreadQueryFieldUnknown';
  }
}

export class ThreadQueryShapeRefused extends Data.TaggedError('ThreadQueryShapeRefused')<{
  readonly message: string;
  readonly detail: string;
}> {
  constructor(detail: string) {
    super({ message: detail, detail });
    this.name = 'ThreadQueryShapeRefused';
  }
}

export function rootOf(path: string): string {
  const dot = path.indexOf('.');
  return dot === -1 ? path : path.slice(0, dot);
}

export function checkThreadQuery(query: ThreadQuery): void {
  const declared = new Set(THREAD_QUERY_FIELDS[query.select]);
  const admit = (path: string): void => {
    if (!declared.has(rootOf(path))) throw new ThreadQueryFieldUnknown(query.select, path);
  };
  for (const predicate of query.where ?? []) {
    admit(predicate.field);
    checkOperand(predicate);
  }
  for (const path of query.fields ?? []) admit(path);
  for (const path of query.group ?? []) admit(path);
  for (const path of query.sum ?? []) admit(path);
  if (query.order === undefined) return;
  if (!grouped(query)) {
    admit(query.order.by);
    return;
  }
  const by = query.order.by;
  if (by !== 'count' && !(query.sum ?? []).includes(by) && !(query.group ?? []).includes(by)) {
    throw new ThreadQueryShapeRefused(
      `A grouped answer orders by count, by a summed path, or by one of its own group fields; ${by} is none of them.`,
    );
  }
}

function checkOperand(predicate: ThreadQueryPredicate): void {
  const { field, op, value } = predicate;
  if (op === 'exists') {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new ThreadQueryShapeRefused(`${field} exists takes true, false, or no value at all.`);
    }
    return;
  }
  if (value === undefined) throw new ThreadQueryShapeRefused(`${field} ${op} … takes a value.`);
  if (op === 'in') {
    if (!Array.isArray(value)) throw new ThreadQueryShapeRefused(`${field} in … takes a list of values.`);
    if (value.length === 0) throw new ThreadQueryShapeRefused(`${field} in [] selects nothing; name the values.`);
    for (const member of value) {
      if (Array.isArray(member)) throw new ThreadQueryShapeRefused(`${field} in … takes plain values, not lists.`);
    }
    return;
  }
  if (Array.isArray(value)) throw new ThreadQueryShapeRefused(`${field} ${op} … takes one value, not a list.`);
  if (op === 'contains' && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new ThreadQueryShapeRefused(`${field} contains … takes a string, a number or a boolean.`);
  }
  if (op !== 'eq' && op !== 'contains' && typeof value !== 'string' && typeof value !== 'number') {
    throw new ThreadQueryShapeRefused(`${field} ${op} … compares numbers or instants, not ${typeof value}.`);
  }
}

export function grouped(query: ThreadQuery): boolean {
  return query.group !== undefined || query.count === true || query.sum !== undefined;
}

export type ThreadPathReading = { readonly found: boolean; readonly value: unknown };
export type ThreadRowRank = { readonly reading: ThreadPathReading; readonly address: string };
export type RankedThreadQueryRow = { readonly rank: ThreadRowRank; row: ThreadQueryRow };

const ABSENT: ThreadPathReading = { found: false, value: undefined };

export function pathReading(row: unknown, path: string): ThreadPathReading {
  let held: unknown = row;
  for (const segment of path.split('.')) {
    if (held === null || held === undefined) return ABSENT;
    if (Array.isArray(held)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return ABSENT;
      const at = Number(segment);
      if (!Number.isInteger(at) || at < 0 || at >= held.length) return ABSENT;
      held = held[at];
      continue;
    }
    if (typeof held !== 'object') return ABSENT;
    if (!Object.hasOwn(held as Record<string, unknown>, segment)) return ABSENT;
    held = (held as Record<string, unknown>)[segment];
  }
  return { found: true, value: held };
}

export function pathValue(row: unknown, path: string): unknown {
  return pathReading(row, path).value;
}

export function matchesThreadQuery(row: ThreadQueryRow, where: readonly ThreadQueryPredicate[] | undefined): boolean {
  for (const predicate of where ?? []) {
    if (!holds(pathReading(row, predicate.field), predicate)) return false;
  }
  return true;
}

function holds(reading: ThreadPathReading, predicate: ThreadQueryPredicate): boolean {
  const { op, value } = predicate;
  if (op === 'exists') return reading.found === (value === undefined ? true : value === true);
  if (!reading.found) return false;
  const held = reading.value;
  if (op === 'in') return (value as readonly ThreadQueryLiteral[]).some((candidate) => same(held, candidate));
  if (op === 'eq') return same(held, value as ThreadQueryLiteral);
  if (op === 'contains') return contained(held, value as ThreadQueryLiteral);
  return ordered(held, value as string | number, op);
}

function same(held: unknown, value: ThreadQueryLiteral): boolean {
  return held === value;
}

function contained(held: unknown, value: ThreadQueryLiteral): boolean {
  if (typeof held === 'string') {
    return typeof value === 'string' ? held.toLowerCase().includes(value.toLowerCase()) : false;
  }
  if (Array.isArray(held)) return held.some((member) => same(member, value));
  if (held !== null && typeof held === 'object' && typeof value === 'string') {
    return Object.hasOwn(held as Record<string, unknown>, value);
  }
  return false;
}

function ordered(held: unknown, value: string | number, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
  if (typeof held === 'number' && typeof value === 'number') return compare(held - value, op);
  if (typeof held === 'string' && typeof value === 'string') return compare(utf8Order(held, value), op);
  return false;
}

function compare(difference: number, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
  if (op === 'gt') return difference > 0;
  if (op === 'gte') return difference >= 0;
  if (op === 'lt') return difference < 0;
  return difference <= 0;
}

export function projectThreadRow(row: ThreadQueryRow, fields: readonly string[], address: readonly string[]): ThreadQueryRow {
  const projected: Record<string, unknown> = {};
  for (const path of address) {
    const held = pathReading(row, path);
    if (held.found) projected[path] = held.value;
  }
  for (const path of fields) {
    const held = pathReading(row, path);
    if (held.found) projected[path] = held.value;
  }
  return projected;
}

export const THREAD_QUERY_ADDRESS: Record<ThreadQuerySource, readonly string[]> = {
  runs: ['threadId', 'runId'],
  steps: ['threadId', 'at'],
  measurements: ['threadId', 'at'],
  entries: ['threadId', 'at'],
  records: ['threadId', 'at'],
  activity: ['threadId', 'at'],
};

export function threadRowRank(row: ThreadQueryRow, order: ThreadQueryOrder): ThreadRowRank {
  return { reading: pathReading(row, order.by), address: addressOf(row) };
}

export function compareThreadRowRanks(left: ThreadRowRank, right: ThreadRowRank, order: ThreadQueryOrder): number {
  const here = left.reading;
  const there = right.reading;
  if (!here.found || !there.found) {
    if (here.found !== there.found) return here.found ? -1 : 1;
  } else {
    const ranked = rank(here.value, there.value);
    if (ranked !== 0) return order.dir === 'desc' ? -ranked : ranked;
  }
  return utf8Order(left.address, right.address);
}

export function orderThreadRows(rows: readonly ThreadQueryRow[], order: ThreadQueryOrder): ThreadQueryRow[] {
  return rows
    .map((row): RankedThreadQueryRow => ({ row, rank: threadRowRank(row, order) }))
    .sort((left, right) => compareThreadRowRanks(left.rank, right.rank, order))
    .map(({ row }) => row);
}

const KIND_ORDER = ['number', 'string', 'boolean', 'other'] as const;

function rank(left: unknown, right: unknown): number {
  const here = kindOf(left);
  const there = kindOf(right);
  if (here !== there) return KIND_ORDER.indexOf(here) - KIND_ORDER.indexOf(there);
  if (here === 'number') return (left as number) - (right as number);
  if (here === 'string') return utf8Order(left as string, right as string);
  if (here === 'boolean') return Number(left) - Number(right);
  return utf8Order(groupKey(left), groupKey(right));
}

function kindOf(value: unknown): (typeof KIND_ORDER)[number] {
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'other';
}

function addressOf(row: ThreadQueryRow): string {
  return ['threadId', 'at', 'runId', 'factKey'].map((path) => groupKey(pathReading(row, path).value)).join('\u0000');
}

export class ThreadQueryFold {
  private readonly groups = new Map<
    string,
    {
      by: Record<string, unknown>;
      absent: string[];
      count: number;
      sum: Map<string, number>;
      unknown: Map<string, number>;
    }
  >();

  constructor(
    private readonly query: ThreadQuery,
    seed: readonly ThreadQueryGroup[] = [],
  ) {
    for (const group of seed) {
      const key = (query.group ?? []).map((path) => (Object.hasOwn(group.by, path) ? groupKey(group.by[path]) : '\u0000absent'));
      this.groups.set(key.join('\u0001'), {
        by: { ...group.by },
        absent: [...(group.absent ?? [])],
        count: group.count ?? 0,
        sum: new Map(Object.entries(group.sum ?? {})),
        unknown: new Map(Object.entries(group.unknown ?? {})),
      });
    }
  }

  take(row: ThreadQueryRow): void {
    const by: Record<string, unknown> = {};
    const absent: string[] = [];
    const key: string[] = [];
    for (const path of this.query.group ?? []) {
      const reading = pathReading(row, path);
      if (reading.found) by[path] = reading.value;
      else absent.push(path);
      key.push(reading.found ? groupKey(reading.value) : '\u0000absent');
    }
    const held = this.groups.get(key.join('\u0001')) ?? {
      by,
      absent,
      count: 0,
      sum: new Map<string, number>(),
      unknown: new Map<string, number>(),
    };
    held.count += 1;
    for (const path of this.query.sum ?? []) {
      const value = pathReading(row, path).value;
      if (typeof value === 'number' && Number.isFinite(value)) {
        held.sum.set(path, (held.sum.get(path) ?? 0) + value);
      } else {
        held.unknown.set(path, (held.unknown.get(path) ?? 0) + 1);
      }
    }
    this.groups.set(key.join('\u0001'), held);
  }

  answer(limit?: number, from = 0): { readonly groups: readonly ThreadQueryGroup[]; readonly more: boolean } {
    const groups: ThreadQueryGroup[] = [...this.groups.values()].map((held) => ({
      by: held.by,
      absent: held.absent.length === 0 ? undefined : held.absent,
      count: this.query.count === true ? held.count : undefined,
      sum: held.sum.size === 0 ? undefined : Object.fromEntries(held.sum),
      unknown: held.unknown.size === 0 ? undefined : Object.fromEntries(held.unknown),
    }));
    const order = this.query.order;
    const ranked =
      order === undefined
        ? groups.sort((left, right) => this.natural(left, right))
        : groups.sort((left, right) => {
            const here = groupValue(left, order.by);
            const there = groupValue(right, order.by);
            if ((here === undefined) !== (there === undefined)) return here === undefined ? 1 : -1;
            const ranking = rank(here, there);
            if (ranking !== 0) return order.dir === 'desc' ? -ranking : ranking;
            return this.natural(left, right);
          });
    if (limit === undefined) return { groups: ranked.slice(from), more: false };
    return { groups: ranked.slice(from, from + limit), more: ranked.length > from + limit };
  }

  private natural(left: ThreadQueryGroup, right: ThreadQueryGroup): number {
    for (const path of this.query.group ?? []) {
      const here = Object.hasOwn(left.by, path);
      const there = Object.hasOwn(right.by, path);
      if (here !== there) return here ? -1 : 1;
      const ranked = here ? rank(left.by[path], right.by[path]) : 0;
      if (ranked !== 0) return ranked;
    }
    return 0;
  }
}

function groupValue(group: ThreadQueryGroup, by: string): unknown {
  if (by === 'count') return group.count;
  return group.sum?.[by] ?? group.by[by];
}

export function groupKey(value: unknown): string {
  if (value === undefined) return '\u0000absent';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(groupKey).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => utf8Order(left, right));
  return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${groupKey(held)}`).join(',')}}`;
}

export function threadEntryIdentity(payload: ThreadEventPayload): string | null {
  const entry = payload.entry as { id?: unknown; runId?: unknown; toolCallId?: unknown } | undefined;
  if (typeof entry?.id !== 'string') return null;
  if (typeof entry.toolCallId !== 'string') return entry.id;
  return `tool:${typeof entry.runId === 'string' ? entry.runId : ''}:${entry.toolCallId}`;
}

export function threadRecordOrigin(payload: ThreadEventPayload, ownRuns: ReadonlySet<string>): 'own' | 'inherited' | 'unknown' {
  const named =
    payload.context?.runId ??
    payload.measurement?.runId ??
    payload.withdrawn?.runId ??
    (payload.entry as { runId?: unknown } | undefined)?.runId;
  if (typeof named !== 'string') return 'unknown';
  return ownRuns.has(named) ? 'own' : 'inherited';
}

export const THREAD_RECORD_FACETS: readonly string[] = Object.keys(threadEventPayloadSchema.fields);

export function recordFacets(payload: ThreadEventPayload): Readonly<Record<string, unknown>> {
  const held: Record<string, unknown> = {};
  for (const facet of THREAD_RECORD_FACETS) {
    const value = (payload as Record<string, unknown>)[facet];
    if (value !== undefined) held[facet] = value;
  }
  return held;
}

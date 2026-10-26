import { Buffer } from 'node:buffer';
import type { ActivityLoss } from '@runlith/activity/fact';
import type { ActivityOrder, ActivityPredicate, ActivityValue } from '@runlith/activity/store/query';
import type { ActivityBodyHeld, ActivityBodyText, ActivityRecord, ActivityRows, ActivityScope } from '@runlith/activity/store/record';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import {
  THREAD_QUERY_ADDRESS,
  THREAD_QUERY_DEFAULT_FIELDS,
  grouped,
  rootOf,
  type ThreadQuery,
  type ThreadQueryCoverage,
  type ThreadQueryGroup,
  type ThreadQueryRow,
} from '@runlith/agent/thread/ThreadQuery';
import { Effect } from 'effect';
import type { EvidenceStop } from '../../threads/contract/service/evidence.js';

const AT = 'activity:';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PER_PAGE = 200;

export type ActivityAnswer = {
  readonly rows: readonly ThreadQueryRow[];
  readonly groups?: readonly ThreadQueryGroup[];
  readonly coverage: ThreadQueryCoverage;
  readonly over: number;
  readonly next: EvidenceStop | null;
};

export function activityAddressOf(at: string | number): string | null {
  if (typeof at !== 'string' || !at.startsWith(AT)) return null;
  const id = at.slice(AT.length);
  return ID.test(id) ? id : null;
}

export function activitySource(record: ActivityRecord['Service']) {
  const answer = Effect.fn('ThreadEvidence.activity')(
    function* (query: ThreadQuery, selected: ActivityScope, from: EvidenceStop | undefined) {
      const scope = { ...selected, where: (query.where ?? []).map(predicateOf) };
      const limit = query.limit ?? PER_PAGE;
      const offset = from?.kind === 'result' ? from.at : 0;
      if (grouped(query)) {
        const group = query.group ?? [];
        const sum = query.sum ?? [];
        const answered = yield* record.groups({
          ...scope,
          group: group.map(pathOf),
          count: query.count === true,
          sum: sum.map(pathOf),
          order: query.order === undefined ? undefined : orderOf(query.order),
          offset,
          limit,
        });
        const groups = answered.groups.map((held): ThreadQueryGroup => {
          const by: Record<string, unknown> = {};
          for (const path of group) if (pathOf(path) in held.by) by[path] = wireValue(path, held.by[pathOf(path)]);
          const absent = group.filter((path) => held.absent.includes(pathOf(path)));
          const summed = keyed(sum, held.sum);
          const unknown = keyed(sum, held.unknown);
          return {
            by,
            absent: absent.length === 0 ? undefined : absent,
            count: query.count === true ? held.count : undefined,
            sum: Object.keys(summed).length === 0 ? undefined : summed,
            unknown: Object.keys(unknown).length === 0 ? undefined : unknown,
          };
        });
        return {
          rows: [],
          groups,
          coverage: coverageOf(answered.more, answered.matched, answered.lost),
          over: answered.threads,
          next: answered.more ? { kind: 'result' as const, at: answered.next } : null,
        };
      }
      const fields = [...new Set([...THREAD_QUERY_ADDRESS.activity, ...(query.fields ?? THREAD_QUERY_DEFAULT_FIELDS.activity)])];
      const paths = fields.map(pathOf);
      const answered: ActivityRows = yield* record.rows({
        ...scope,
        paths,
        order: query.order === undefined ? undefined : orderOf(query.order),
        offset,
        limit,
      });
      const rows = answered.rows.map((row) => {
        const projected: Record<string, unknown> = {};
        for (const [index, path] of fields.entries()) {
          const kit = paths[index]!;
          if (kit in row.values) projected[path] = wireValue(path, row.values[kit]);
        }
        return projected;
      });
      const next: EvidenceStop | null = answered.more ? { kind: 'result', at: answered.next } : null;
      return {
        rows,
        coverage: coverageOf(answered.more, answered.matched, answered.lost, answered.unavailable),
        over: answered.threads,
        next,
      };
    },
    (effect, query, selected, from) => effect.pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
  );

  const expanded = Effect.fn('ThreadEvidence.expandedActivity')(
    function* (threadId: string, id: string, room: number) {
      const held = yield* record.activity(id);
      if (held === null || held.thread !== threadId) return null;
      const { thread, run, bodies: listed, ...rest } = held;
      const base = { threadId: thread, at: `${AT}${id}`, runId: run, ...rest };
      const written = (listed ?? []) as readonly ActivityBodyHeld[];
      let left = room - encodedBytes({ ...base, bodies: written });
      const bodies: unknown[] = [];
      for (const body of written) {
        if (body.state !== 'written') {
          bodies.push(body);
          continue;
        }
        if (body.size > left) {
          bodies.push({ ...body, unread: true });
          continue;
        }
        const read = yield* Effect.result(record.body(id, body.n, body.size));
        if (read._tag === 'Failure') {
          bodies.push({ ...body, unreadable: read.failure.reason });
          continue;
        }
        const shown = { ...body, ...decoded(read.success.text, body.contentType) };
        const cost = encodedBytes(shown) - encodedBytes(body);
        if (cost > left) {
          bodies.push({ ...body, unread: true });
          continue;
        }
        left -= cost;
        bodies.push(shown);
      }
      return { ...base, bodies };
    },
    (effect, threadId, id, room) => effect.pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
  );

  const body = Effect.fnUntraced(function* (
    threadId: string,
    id: string,
    n: number,
    from: number,
    bytes: number,
  ): Effect.fn.Return<ActivityBodyText | { readonly unavailable: string }> {
    return yield* record
      .body(id, n, bytes, from, threadId)
      .pipe(Effect.catchTag('ActivityUnreadable', (failure) => Effect.succeed({ unavailable: failure.reason })));
  });

  return { answer, expanded, body };
}

export function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function decoded(text: string, contentType: string): { readonly value: unknown } | { readonly text: string } {
  if (!/[/+]json\b/.test(contentType)) return { text };
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { text };
  }
}

function pathOf(path: string): string {
  const root = rootOf(path);
  const named = root === 'threadId' ? 'thread' : root === 'runId' ? 'run' : root === 'at' ? 'id' : root;
  return named + path.slice(root.length);
}

function predicateOf(predicate: NonNullable<ThreadQuery['where']>[number]): ActivityPredicate {
  const value = predicate.value;
  const kit = (held: ActivityValue): ActivityValue =>
    rootOf(predicate.field) === 'at' && typeof held === 'string' && held.startsWith(AT) ? held.slice(AT.length) : held;
  return {
    path: pathOf(predicate.field),
    op: predicate.op,
    value: value === undefined ? undefined : Array.isArray(value) ? value.map(kit) : kit(value as ActivityValue),
  };
}

function orderOf(order: NonNullable<ThreadQuery['order']>): ActivityOrder {
  return { by: order.by === 'count' ? 'count' : pathOf(order.by), dir: order.dir };
}

function wireValue(path: string, value: unknown): unknown {
  return path === 'at' && typeof value === 'string' ? `${AT}${value}` : value;
}

function keyed(paths: readonly string[], held: Readonly<Record<string, number>>): Record<string, number> {
  const named: Record<string, number> = {};
  for (const path of paths) {
    const value = held[pathOf(path)];
    if (value !== undefined) named[path] = value;
  }
  return named;
}

function coverageOf(more: boolean, read: number, lost: readonly ActivityLoss[], unavailable: readonly string[] = []): ThreadQueryCoverage {
  const missing = lost.some((loss) => loss.facts > 0 || loss.unknown === true) || unavailable.length > 0;
  return {
    complete: !missing,
    unavailable,
    truncated: more,
    read,
    lost: lost.length === 0 ? undefined : lost,
  };
}

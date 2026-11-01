import { Effect } from 'effect';
import {
  ThreadQueryFieldUnknown,
  ThreadQueryShapeRefused,
  checkThreadQuery,
  threadRecordOrigin,
  type ThreadKernelSource,
  type ThreadQuery,
  type ThreadQueryCoverage,
  type ThreadQueryGroup,
  type ThreadQueryRow,
} from '@runlith/agent/thread/ThreadQuery';
import type { ThreadEventRecord } from '@runlith/agent/thread/events';
import {
  EvidenceQueries,
  type EvidenceAddress,
  type EvidencePin,
  type EvidencePinnedThread,
  type EvidenceReader,
  type EvidenceStop,
  type ExpandedEvidenceRecord,
  type PinnedEvidence,
  type PinnedEvidenceQuery,
  type ToolOutputPage,
  EvidenceReads,
} from '../../threads/contract/service/evidence.js';
import { entryOf } from '@runlith/agent/transcript/kinds';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { queryTargets, wholePopulation } from './retained.js';
import { activityAddressOf, activitySource, encodedBytes } from './activity.js';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { ThreadInputRefused, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { threadRecordAddress, wireExpanded } from '../../threads/list/wire.js';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ActivityRecord } from '@runlith/activity/store/record';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { ThreadWindows } from '../../threads/contract/service/reads.js';
import { ThreadList } from '../../threads/contract/service/list.js';
import type { ThreadRunStore } from '../runs/ledger.js';
import type { RetainedSlice } from '../tools/outputStore.js';

const PER_PAGE = 200;

export type EvidenceGate = {
  readonly opened: <A, R>(
    threadId: string,
    projectId: number,
    work: () => Effect.Effect<A, HarnessFailure, R>,
  ) => Effect.Effect<A, HarnessFailure, R>;
  readonly resolveRecord: (threadId: string, record: ThreadEventRecord) => Effect.Effect<ThreadEventRecord>;
  readonly retainedSlice: (threadId: string, outputId: string, from: number, length: number) => Effect.Effect<RetainedSlice>;
};

export type EvidenceReadingInput = { readonly runs: ThreadRunStore; readonly gate: EvidenceGate };

export const evidenceReading = Effect.fnUntraced(function* ({ runs, gate }: EvidenceReadingInput) {
  const harness = yield* ThreadHarness;
  const threads = yield* ThreadWindows;
  const reads = yield* EvidenceReads;
  const list = yield* ThreadList;
  const activity = yield* ActivityRecord;
  const { opened, resolveRecord, retainedSlice } = gate;
  const source = activitySource(activity);

  const holding = <A>(
    threadIds: readonly string[],
    projectId: number,
    work: Effect.Effect<A, HarnessFailure>,
  ): Effect.Effect<A, HarnessFailure> =>
    [...new Set(threadIds)].reduceRight<Effect.Effect<A, HarnessFailure>>(
      (inner, threadId) => opened(threadId, projectId, () => inner),
      work,
    );

  const pinned = (selected: readonly string[]): Effect.Effect<readonly EvidencePinnedThread[], HarnessFailure> =>
    Effect.forEach(selected, (threadId) =>
      Effect.map(harness.reads.pin(threadId), (target) => ({ threadId, facts: { head: target.head, runs: target.runs } })),
    );

  const pagedResult = Effect.fnUntraced(function* (
    reader: EvidenceReader,
    pin: EvidencePin,
    query: ThreadQuery & { readonly select: ThreadKernelSource },
    from: EvidenceStop | undefined,
  ): Effect.fn.Return<
    {
      rows: readonly ThreadQueryRow[];
      groups?: readonly ThreadQueryGroup[];
      coverage: ThreadQueryCoverage;
      next: EvidenceStop | null;
    },
    HarnessFailure
  > {
    const wanted = query.limit ?? PER_PAGE;
    const shown = from?.kind === 'result' ? from.at : 0;
    const standing = yield* reads.held(reader, pin);
    const walking = from?.kind === 'source' ? from : undefined;
    if (walking !== undefined && (standing?.walk?.kind !== 'source' || !sameStop(standing.walk, walking)))
      return yield* Effect.fail(
        new ThreadInputRefused('cursor-stale', 'This cursor continues a walk its reading already took further.', [
          'continue from the newest cursor this reading answered, or open the query again without a cursor',
        ]),
      );
    const { limit: _page, ...evaluated } = query;
    const result =
      walking === undefined && standing !== null
        ? standing
        : yield* Effect.tap(
            Effect.map(
              harness.reads.query({
                query: { ...evaluated, select: query.select },
                targets: queryTargets(pin),
                from: walking,
                seed: walking === undefined ? undefined : standing?.groups,
              }),
              (answered): PinnedEvidence => ({
                ...(answered.groups === undefined ? { rows: answered.rows } : { groups: answered.groups }),
                coverage:
                  walking === undefined || standing === null
                    ? answered.coverage
                    : {
                        ...answered.coverage,
                        read: standing.coverage.read + answered.coverage.read,
                        unavailable: [...standing.coverage.unavailable, ...answered.coverage.unavailable],
                      },
                walk:
                  answered.groups !== undefined && answered.coverage.cut === 'read-ceiling' && answered.next?.kind === 'source'
                    ? answered.next
                    : undefined,
              }),
            ),
            (computed) => reads.retain(reader, pin, computed),
          );
    const answer = result.groups ?? result.rows ?? [];
    const page = answer.slice(shown, shown + wanted);
    const more = shown + page.length < answer.length;
    return {
      rows: result.groups === undefined ? (page as readonly ThreadQueryRow[]) : [],
      groups: result.groups === undefined ? undefined : (page as readonly ThreadQueryGroup[]),
      coverage: { ...result.coverage, truncated: more || result.coverage.truncated },
      next: more ? { kind: 'result', at: shown + page.length } : (result.walk ?? null),
    };
  });

  return EvidenceQueries.of({
    resolve: Effect.fnUntraced(function* (reader, projectId, request) {
      if (!('query' in request)) {
        const { pin } = yield* reads.resume(reader, request.cursor);
        if (pin.asks.kind !== 'query')
          return yield* new ThreadInputRefused('cursor-stale', 'This cursor continues a thread listing, not an evidence query.', [
            'continue this cursor with list_threads, or open a new read_thread query',
          ]);
        return { query: pin.asks.query, threads: pin.threads.map((target) => target.threadId), cursor: request.cursor };
      }
      const carry = (threads: readonly string[]): PinnedEvidenceQuery => ({
        query: request.query,
        threads,
        cursor: request.cursor,
      });
      if (request.query.select === 'activity') return { ...request };
      if (request.cursor !== undefined) {
        const resumed = yield* reads.resume(reader, request.cursor, {
          asks: { kind: 'query', query: request.query },
          threads: request.threads,
        });
        return carry(resumed.pin.threads.map((target) => target.threadId));
      }
      if (request.selection === undefined) return carry(request.threads);
      const matched = (yield* threads.list(OPERATOR_PRINCIPAL, { id: projectId, projects: [projectId] }, request.selection)).rows.map(
        (row) => row.id,
      );
      return carry([...request.threads, ...matched.filter((id) => !request.threads.includes(id))]);
    }),

    list: Effect.fnUntraced(function* (reader, projectId, request) {
      const { limit } = request;
      const resumed =
        request.cursor === undefined
          ? null
          : yield* reads.resume(reader, request.cursor, {
              asks: { kind: 'list', selection: request.asked },
              threads: [],
            });
      const at = resumed?.from.kind === 'source' ? resumed.from.at : 0;
      const reading =
        resumed?.pin.listing?.reading ??
        (yield* threads.pin(OPERATOR_PRINCIPAL, { id: projectId, projects: [projectId] }, request.selection));
      const selected = yield* threads.page(OPERATOR_PRINCIPAL, projectId, reading, at, limit);
      const pin =
        resumed?.pin ??
        (yield* reads.pin(reader, {
          asks: { kind: 'list', selection: request.asked },
          threads: [],
          listing: { reading, total: selected.total, project: projectId },
        }));
      if (pin.listing?.project !== projectId)
        return yield* new ThreadInputRefused('cursor-stale', 'This cursor names another thread project.', [
          'open the thread listing again without a cursor',
        ]);
      const slice = selected.ids;
      const page = slice.length === 0 ? { rows: [] } : yield* list.list(projectId, { view: 'all', ids: slice });
      const held = new Map(page.rows.map((row) => [row.id, row]));
      const rows = slice.flatMap((threadId) => {
        const row = held.get(threadId);
        return row === undefined ? [] : [row];
      });
      const stop = at + slice.length;
      return {
        rows,
        total: selected.total,
        cursor: stop >= selected.total ? null : reads.cursor(reader, pin, { kind: 'source', at: stop, sourceKey: null }),
        set: request.selection.view,
      };
    }),

    query: Effect.fnUntraced(function* (reader, projectId, request) {
      const query = request.query;
      yield* Effect.try({
        try: () => checkThreadQuery(query),
        catch: (cause) =>
          cause instanceof ThreadQueryFieldUnknown
            ? new ThreadInputRefused('unknown-field', cause.message, [
                `name one of: ${cause.declared.join(', ')}`,
                'reach into recorded payload by writing a path under one of them',
              ])
            : new ThreadInputRefused('selection-shape', (cause as ThreadQueryShapeRefused).message, [
                'ask the query in a shape this source can answer',
              ]),
      });
      const resumed =
        request.cursor === undefined
          ? null
          : yield* reads.resume(reader, request.cursor, {
              asks: { kind: 'query', query },
              threads: request.threads,
              selection: request.selection === undefined ? undefined : JSON.stringify(request.selection),
            });
      if (query.select === 'activity') {
        const selected = request.selection;
        const directWindow =
          selected?.active !== undefined &&
          selected.view === 'all' &&
          request.threads.length === 0 &&
          Object.entries(selected).every(([key, value]) => value === undefined || key === 'view' || key === 'active' || key === 'ids');
        const pin =
          resumed?.pin ??
          (yield* reads.pin(reader, {
            asks: { kind: 'query', query },
            threads: request.threads.map((threadId) => ({ threadId })),
            selection: selected === undefined ? undefined : JSON.stringify(selected),
            activity: {
              project: projectId,
              window: directWindow
                ? {
                    project: projectId,
                    since: selected.active?.since?.getTime(),
                    before: selected.active?.before?.getTime(),
                  }
                : undefined,
              members: directWindow && selected.ids !== undefined ? true : undefined,
            },
          }));
        yield* Effect.forEach(request.threads, (threadId) => opened(threadId, projectId, () => Effect.void), { discard: true });
        if (resumed === null)
          for (let at = 0; at < request.threads.length; at += 50)
            yield* activity
              .members(pin.id, request.threads.slice(at, at + 50))
              .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
        if (resumed === null && directWindow && selected.ids !== undefined) {
          yield* Effect.forEach(selected.ids, (threadId) => opened(threadId, projectId, () => Effect.void), { discard: true });
          for (let at = 0; at < selected.ids.length; at += 50)
            yield* activity
              .members(pin.id, selected.ids.slice(at, at + 50))
              .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
        }
        if (resumed === null && selected !== undefined && !directWindow) {
          const { active: _active, ...metadata } = selected;
          if (selected.active !== undefined) {
            let after: string | undefined;
            let reading: string | undefined;
            do {
              const active = yield* activity
                .threads({
                  project: projectId,
                  limit: 50,
                  before: Math.min(selected.active.before?.getTime() ?? Number.POSITIVE_INFINITY, Date.parse(pin.pinnedAt) + 1),
                  since: selected.active.since?.getTime(),
                  ids: selected.ids,
                  after,
                  reading,
                })
                .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
              if (active.threads.length > 0) {
                const page = yield* threads.list(
                  OPERATOR_PRINCIPAL,
                  { id: projectId, projects: [projectId] },
                  { ...metadata, ids: active.threads, limit: 50 },
                );
                yield* activity
                  .members(
                    pin.id,
                    page.rows.map((row) => row.id),
                  )
                  .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
              }
              after = active.after ?? undefined;
              reading = active.reading;
            } while (after !== undefined);
          } else {
            let before = metadata.before;
            do {
              const page = yield* threads.list(
                OPERATOR_PRINCIPAL,
                { id: projectId, projects: [projectId] },
                {
                  ...metadata,
                  limit: 50,
                  before,
                },
              );
              yield* activity
                .members(
                  pin.id,
                  page.rows.map((row) => row.id),
                )
                .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
              before = page.before ?? undefined;
            } while (before !== undefined);
          }
        }
        const scope = pin.activity;
        if (scope === undefined || scope.project !== projectId)
          return yield* Effect.fail(
            new ThreadInputRefused('cursor-stale', 'This cursor names another activity project.', [
              'open the query again without a cursor',
            ]),
          );
        const answered = yield* source.answer(
          query,
          {
            project: projectId,
            through: Date.parse(pin.pinnedAt),
            reading: pin.id,
            resumed: resumed === null ? undefined : (true as const),
            where: [],
            members: scope.window === undefined || scope.members === true ? pin.id : undefined,
            window:
              scope.window === undefined
                ? undefined
                : {
                    ...scope.window,
                    before: Math.min(scope.window.before ?? Number.POSITIVE_INFINITY, Date.parse(pin.pinnedAt) + 1),
                  },
          },
          resumed?.from,
        );
        return {
          select: query.select,
          threads: [],
          over: answered.over,
          rows: answered.rows,
          groups: answered.groups,
          coverage: answered.coverage,
          cursor: reads.cursor(reader, pin, answered.next),
        };
      }
      const named = resumed?.pin.threads.map((target) => target.threadId) ?? request.threads;
      const kernelQuery = { ...query, select: query.select };
      const { pin, answered } = yield* holding(
        named,
        projectId,
        Effect.gen(function* () {
          const targets = resumed?.pin.threads ?? (yield* pinned(named));
          const pin = resumed?.pin ?? (yield* reads.pin(reader, { asks: { kind: 'query', query }, threads: targets }));
          const answered = wholePopulation(query)
            ? yield* pagedResult(reader, pin, kernelQuery, resumed?.from)
            : yield* harness.reads.query({
                query: kernelQuery,
                targets: queryTargets(pin),
                from: resumed?.from === undefined ? undefined : resumed.from,
              });
          return { pin, answered };
        }),
      );
      return {
        select: query.select,
        threads: queryTargets(pin).map(({ threadId, head }) => ({ threadId, head })),
        over: pin.threads.length,
        rows: answered.rows,
        groups: answered.groups,
        coverage: answered.coverage,
        cursor: reads.cursor(reader, pin, answered.next),
      };
    }),

    expand: Effect.fnUntraced(function* (projectId, input) {
      const expanded: ExpandedEvidenceRecord[] = [];
      const owned = new Map<string, boolean>();
      const ownsRun = (threadId: string, runId: string) => {
        const held = owned.get(`${threadId}\u0000${runId}`);
        return held !== undefined
          ? Effect.succeed(held)
          : Effect.tap(runs.owns(threadId, runId), (own) => Effect.sync(() => owned.set(`${threadId}\u0000${runId}`, own)));
      };
      const originOf = (threadId: string, payload: ThreadEventRecord['payload']) => {
        const named = [
          payload.context?.runId,
          payload.runId,
          payload.measurement?.runId,
          payload.withdrawn?.runId,
          (payload.entry as { runId?: unknown } | undefined)?.runId,
        ];
        return Effect.map(
          Effect.filter(
            named.filter((runId): runId is string => typeof runId === 'string'),
            (runId) => ownsRun(threadId, runId),
          ),
          (own) => threadRecordOrigin(payload, new Set(own)),
        );
      };
      if (
        input.body !== undefined &&
        (input.outputFrom === undefined || input.addresses.some((address) => activityAddressOf(address.at) === null))
      )
        return yield* Effect.fail(
          new ThreadInputRefused('selection-shape', 'A body number selects an activity output page.', [
            'name only activity addresses and outputFrom, or drop body',
          ]),
        );
      if (input.outputFrom !== undefined && (input.around ?? 0) > 0)
        return yield* Effect.fail(
          new ThreadInputRefused('selection-shape', 'An output page carries no neighbouring records.', [
            'drop around, or read the neighbours in a call without outputFrom',
          ]),
        );
      let left = TOOL_OUTPUT_MAX_BYTES - input.envelopeBytes;
      const unread = (address: EvidenceAddress): ExpandedEvidenceRecord => ({
        ...address,
        unread:
          'This address exceeds the answer envelope: read it alone, or page its tool output or activity body with outputFrom 0; body selects the activity body’s n (default 1).',
      });
      const cost = (item: ExpandedEvidenceRecord) => encodedBytes(wireExpanded(item, input.fields)) + (expanded.length === 0 ? 0 : 1);
      let reserved = 0;
      for (const [index, address] of input.addresses.entries()) {
        reserved += encodedBytes(unread(address)) + (index === 0 ? 0 : 1);
        if (reserved > left)
          return yield* Effect.fail(
            new ThreadInputRefused('selection-shape', 'These addresses cannot fit in one expansion answer.', [
              'name fewer or shorter addresses',
            ]),
          );
      }
      const answered = Effect.fnUntraced(function* (item: ExpandedEvidenceRecord, address: EvidenceAddress) {
        const shown = cost(item) <= left - reserved ? item : unread(address);
        const bytes = cost(shown);
        if (bytes > left - reserved)
          return yield* Effect.fail(
            new ThreadInputRefused('selection-shape', 'The requested neighbours cannot fit in one expansion answer.', [
              'reduce around or name fewer addresses',
            ]),
          );
        left -= bytes;
        expanded.push(shown);
      });
      const expandAll = Effect.gen(function* () {
        for (const [index, address] of input.addresses.entries()) {
          reserved -= encodedBytes(unread(address)) + (index === 0 ? 0 : 1);
          const recorded = activityAddressOf(address.at);
          if (recorded !== null) {
            if (input.outputFrom !== undefined) {
              const room = left - reserved;
              const read = yield* source.body(address.threadId, recorded, input.body ?? 1, input.outputFrom, room + UTF8_TAIL);
              if ('unavailable' in read) {
                yield* answered({ ...address, missing: read.unavailable }, address);
                continue;
              }
              const page = outputPage(
                { bytes: Buffer.from(read.text), start: read.from, total: read.bytes },
                (candidate) => cost({ ...address, output: candidate }) <= room,
              );
              yield* answered(page === null ? unread(address) : { ...address, output: page }, address);
              continue;
            }
            const room = left - reserved - encodedBytes({ ...address, fact: {} }) + 2 - (expanded.length === 0 ? 0 : 1);
            const fact = yield* source.expanded(address.threadId, recorded, room);
            yield* answered(
              fact === null ? { ...address, missing: `No activity at ${address.at} of ${address.threadId}.` } : { ...address, fact },
              address,
            );
            continue;
          }
          const at = threadRecordAddress(address.at);
          const record = yield* 'position' in at
            ? harness.reads.entryAt(address.threadId, at.position)
            : harness.reads.entryNamed(address.threadId, at.recordId);
          if (record === null) {
            yield* answered({ ...address, missing: `No record at ${address.at} of ${address.threadId}.` }, address);
            continue;
          }
          if (input.outputFrom !== undefined) {
            const entry = record.payload.entry;
            if (entry === undefined || !entryOf('tool')(entry) || entry.toolOutput === undefined) {
              yield* answered({ ...address, missing: `No tool output at ${address.at} of ${address.threadId}.` }, address);
              continue;
            }
            const room = left - reserved;
            const retained = retainedOutputId(entry.toolOutput);
            const window: RetainedSlice =
              retained === null
                ? inlineWindow(entry.toolOutput, input.outputFrom, room + UTF8_TAIL)
                : yield* retainedSlice(address.threadId, retained, input.outputFrom, room + UTF8_TAIL);
            if ('unavailable' in window) {
              yield* answered(
                { ...address, missing: `The retained tool output ${retained} at ${address.at} cannot be read: ${window.unavailable}` },
                address,
              );
              continue;
            }
            const page = outputPage(window, (candidate) => cost({ ...address, output: candidate }) <= room);
            yield* answered(page === null ? unread(address) : { ...address, output: page }, address);
            continue;
          }
          yield* answered(
            {
              ...address,
              record: yield* resolveRecord(address.threadId, record),
              origin: yield* originOf(address.threadId, record.payload),
            },
            address,
          );
          const around = input.around ?? 0;
          if (around === 0) continue;
          const neighbours = yield* harness.reads.window(address.threadId, {
            after: Math.max(0, record.position - around - 1),
            limit: around * 2 + 1,
          });
          for (const near of neighbours.records) {
            if (near.position === record.position) continue;
            yield* answered(
              {
                threadId: address.threadId,
                at: near.position,
                record: yield* resolveRecord(address.threadId, near),
                origin: yield* originOf(address.threadId, near.payload),
              },
              { threadId: address.threadId, at: near.position },
            );
          }
        }
      });
      yield* holding(
        input.addresses.map((address) => address.threadId),
        projectId,
        expandAll,
      );
      return expanded;
    }),
  });
});

const sameStop = (left: EvidenceStop, right: EvidenceStop): boolean =>
  left.kind === 'source'
    ? right.kind === 'source' && left.at === right.at && left.sourceKey === right.sourceKey
    : right.kind === 'result' && left.at === right.at;

const UTF8_TAIL = 4;

function retainedOutputId(output: unknown): string | null {
  if (typeof output !== 'object' || output === null) return null;
  const held = output as { readonly truncated?: unknown; readonly outputId?: unknown };
  return held.truncated === true && typeof held.outputId === 'string' ? held.outputId : null;
}

function inlineWindow(output: unknown, from: number, length: number): RetainedSlice {
  const encoded = Buffer.from(typeof output === 'string' ? output : JSON.stringify(output), 'utf8');
  const start = Math.min(from, encoded.length);
  return { bytes: encoded.subarray(start, start + length), start, total: encoded.length };
}

function outputPage(
  window: Extract<RetainedSlice, { readonly bytes: Uint8Array }>,
  fits: (page: ToolOutputPage) => boolean,
): ToolOutputPage | null {
  const { bytes, start, total } = window;
  const whole = start + bytes.length >= total;
  const continues = (at: number) => at < bytes.length && (bytes[at]! & 0xc0) === 0x80;
  let first = 0;
  while (continues(first)) first += 1;
  const from = start + first;
  const decoder = new TextDecoder();
  const pageTo = (end: number): ToolOutputPage => {
    let cut = end;
    while (cut > first && continues(cut)) cut -= 1;
    return { text: decoder.decode(bytes.subarray(first, cut)), from, bytes: total, next: start + cut < total ? start + cut : null };
  };
  let best: ToolOutputPage | null = null;
  let low = 0;
  let high = Math.max(0, (whole ? bytes.length : bytes.length - UTF8_TAIL) - first);
  while (low <= high) {
    const middle = (low + high) >> 1;
    const page = pageTo(first + middle);
    if (fits(page)) {
      best = page;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best !== null && (best.next === null || best.next > from) ? best : null;
}

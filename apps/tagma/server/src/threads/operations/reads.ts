import { pageRows } from '@runlith/paging';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { expandedDisplay } from '../voice/display.js';
import { Effect } from 'effect';
import type { Actor } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair, type InputOf } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import type { ThreadSelectionQuery } from '../contract/wire/selection.js';
import {
  type CacheWarmth,
  EvidenceQueries,
  ThreadEvidence,
  type EvidenceQueryAnswer,
  type EvidenceReader,
  type PinnedEvidenceQuery,
  type ResolvedEvidenceInput,
  type ThreadEvidenceSnapshot,
} from '../contract/service/evidence.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { ThreadRecaps } from '../contract/service/recaps.js';
import { Conversations } from '../contract/service/conversations.js';
import {
  evidenceQueryOf,
  threadSelectionOf,
  wireEvidenceAnswer,
  wireExpanded,
  wireThreadAnswer,
  wireThreadFacts,
  wireThreadShape,
} from '../list/wire.js';
import type { ThreadSelectorInput } from '../contract/wire/selection.js';
import type { ContextLimits } from '../contract/service/limits.js';
import { rowThreads, threadBasis } from '../list/basis.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { THREAD_OPERATIONS, THREADS } from '../contract/wire/operations/catalog.js';
import { answering } from './answering.js';

const readerOf = (actor: Actor): Effect.Effect<EvidenceReader, never> =>
  actor.kind === 'thread' ? Effect.succeed({ kind: 'thread', threadId: actor.threadId }) : Effect.succeed({ kind: 'operator' });

function selectionTerms(input: ThreadSelectorInput): ThreadSelectionQuery {
  const joined = (values: readonly string[] | undefined): string | undefined =>
    values === undefined || values.length === 0 ? undefined : values.join(',');
  const terms: Record<string, string> = {};
  const put = (name: string, value: string | undefined): void => {
    if (value !== undefined) terms[name] = value;
  };
  put('set', input.set);
  put('state', input.state);
  put('ids', joined(input.ids));
  put('plugin', input.plugin);
  put('title', input.title);
  put('of', input.of);
  put('reach', input.reach);
  put('models', joined(input.models));
  put('providers', joined(input.providers));
  put('ranSince', input.ranSince);
  put('ranBefore', input.ranBefore);
  put('activeSince', input.activeSince);
  put('activeBefore', input.activeBefore);
  put('createdSince', input.createdSince);
  put('createdBefore', input.createdBefore);
  put('updatedSince', input.updatedSince);
  put('updatedBefore', input.updatedBefore);
  put('readerSince', input.readerSince);
  put('readerBefore', input.readerBefore);
  put('archivedSince', input.archivedSince);
  put('archivedBefore', input.archivedBefore);
  return terms as ThreadSelectionQuery;
}

export type ThreadEvidenceTargets = {
  readonly project: number;
  readonly request: PinnedEvidenceQuery | null;
};

const evidenceRequestOf = Effect.fn('read_thread.request')(function* (input: InputOf<typeof THREAD_OPERATIONS.read_thread>) {
  if (input.select === undefined) {
    if (input.cursor === undefined) return null;
    if (Object.entries(input).some(([key, value]) => value !== undefined && key !== 'cursor' && key !== 'project'))
      return yield* new GateRefusal('selection-shape', 'A continuation without select uses its saved question.', [
        'send the cursor alone',
        'repeat the question with select to check it against the cursor',
      ]);
    return { cursor: input.cursor };
  }
  const threads = [...(input.threadId === undefined ? [] : [input.threadId]), ...(input.threads ?? [])];
  const selection =
    input.selection === undefined
      ? undefined
      : yield* threadSelectionOf(
          selectionTerms({
            ...input.selection,
            set: input.selection.set ?? (input.select === 'activity' ? ('all' as const) : undefined),
          }),
        );
  if (threads.length === 0 && selection === undefined && input.cursor === undefined) return null;
  return {
    query: evidenceQueryOf({
      select: input.select,
      where: input.where,
      fields: input.fields,
      group: input.group,
      count: input.count,
      sum: input.sum,
      order: input.order,
      limit: input.limit,
    }),
    threads,
    selection,
    cursor: input.cursor,
  } satisfies ResolvedEvidenceInput;
});

const OPS = THREAD_OPERATIONS;

export const READ_PAIRS = {
  list_threads: pair(
    OPS.list_threads,
    body(OPS.list_threads, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const page = yield* answering(
          'list_threads',
          Effect.gen(function* () {
            const limit = pageRows(input.limit, THREADS, ceilingOf(THREADS));
            const asked: ThreadSelectionQuery = { ...selectionTerms(input), limit: String(limit) };
            const project = (yield* yield* CurrentProject).project.id;
            const selection = yield* threadSelectionOf(asked);
            const listed = yield* (yield* EvidenceQueries).list(yield* readerOf(caller.actor), project, {
              asked,
              selection,
              limit,
              cursor: input.cursor,
            });
            if (input.shape === 'rows') {
              const basis = yield* threadBasis(rowThreads(listed.rows));
              return { kind: 'rows' as const, listing: wireThreadAnswer(listed, basis) };
            }
            return { kind: 'facts' as const, listed };
          }),
        );
        return page.kind === 'rows'
          ? { status: 'rows' as const, rows: page.listing.rows, total: page.listing.total, before: page.listing.before }
          : {
              status: 'ok' as const,
              threads: page.listed.rows.map(wireThreadFacts),
              total: page.listed.total,
              cursor: page.listed.cursor,
              set: page.listed.set,
            };
      }),
    }),
  ),

  read_thread: pair(
    OPS.read_thread,
    body<
      typeof OPS.read_thread,
      ThreadEvidenceTargets,
      CurrentProject | ThreadEvidence | EvidenceQueries | CacheWarmth | ContextLimits | ThreadRecaps
    >(OPS.read_thread, {
      prepare: Effect.fn('read_thread.prepare')(function* (input, caller) {
        return yield* answering(
          'read_thread',
          Effect.gen(function* () {
            const project = (yield* yield* CurrentProject).project.id;
            const request = yield* evidenceRequestOf(input);
            if (request === null) return { project, request: null } satisfies ThreadEvidenceTargets;
            const resolved = yield* (yield* EvidenceQueries).resolve(yield* readerOf(caller.actor), project, request);
            return { project, request: resolved } satisfies ThreadEvidenceTargets;
          }),
        );
      }),
      execute: Effect.fnUntraced(function* (input, prepared: ThreadEvidenceTargets, caller) {
        const read = yield* answering(
          'read_thread',
          Effect.gen(function* () {
            const evidence = yield* ThreadEvidence;
            if (input.select === undefined && prepared.request === null) {
              if (input.threadId === undefined) {
                return yield* new GateRefusal('selection-shape', 'A thread shape is read of one thread.', [
                  'name `threadId`',
                  'name `select` to query facts across threads',
                ]);
              }
              const shape = yield* evidence.shape(input.threadId, prepared.project);
              const recaps = yield* (yield* ThreadRecaps).readings([{ id: input.threadId, projectId: shape.facet.projectId }]);
              return {
                kind: 'shape' as const,
                shape,
                basis: yield* threadBasis(
                  rowThreads([
                    {
                      ...shape.shape.thread,
                      projectId: shape.facet.projectId,
                      activeRun: shape.shape.runs.find((run) => run.status === 'running') ?? null,
                    },
                  ]),
                ),
                recap: recaps.get(input.threadId),
              };
            }
            const request = prepared.request;
            if (request === null) {
              return yield* new GateRefusal('selection-shape', 'A query names the threads it reads.', [
                'name `threadId`, or `threads` for a set',
                'name `selection` for a lineage or a clock',
                'list_threads selects the set',
              ]);
            }
            return {
              kind: 'facts' as const,
              facts: yield* (yield* EvidenceQueries).query(yield* readerOf(caller.actor), prepared.project, request),
            };
          }),
        );
        return read.kind === 'shape'
          ? { status: 'ok' as const, shape: wireThreadShape(read.shape, read.basis, read.recap) }
          : { status: 'ok' as const, evidence: wireEvidenceAnswer(read.facts) };
      }),
    }),
  ),

  read_thread_record: pair(
    OPS.read_thread_record,
    body(OPS.read_thread_record, {
      execute: Effect.fnUntraced(function* (input) {
        const records = yield* answering(
          'read_thread_record',
          Effect.gen(function* () {
            const project = (yield* yield* CurrentProject).project.id;
            const addresses: Array<{ readonly threadId: string; readonly at: number | string }> = [];
            for (const address of input.at ?? []) {
              const thread = address.threadId ?? input.threadId;
              if (thread === undefined) {
                return yield* new GateRefusal(
                  'selection-shape',
                  `The address ${String(address.at)} names no thread, and the call names none for it to stand in.`,
                  [
                    'Name `threadId` on the call: every address without one stands in that thread.',
                    'Or give this address its own `threadId`.',
                  ],
                );
              }
              addresses.push({ threadId: thread, at: address.at });
            }
            if (input.conversation === true) {
              if (input.outputFrom !== undefined || input.body !== undefined)
                return yield* new GateRefusal('selection-shape', 'A conversation window carries no output pages.', [
                  'drop outputFrom, or read the output in a call without conversation',
                ]);
              return {
                kind: 'conversation' as const,
                windows: yield* (yield* Conversations).window(project, { addresses, around: input.around ?? 0 }),
              };
            }
            return {
              kind: 'records' as const,
              records: yield* (yield* EvidenceQueries).expand(project, {
                addresses,
                envelopeBytes: Buffer.byteLength(
                  JSON.stringify({
                    status: 'ok',
                    expanded: [],
                    _meta: { toolDisplay: expandedDisplay(input.threadId, TOOL_OUTPUT_MAX_BYTES * 2, TOOL_OUTPUT_MAX_BYTES) },
                  }),
                ),
                around: input.around,
                fields: input.fields,
                outputFrom: input.outputFrom,
                body: input.body,
              }),
            };
          }),
        );
        return records.kind === 'conversation'
          ? { status: 'conversation' as const, windows: records.windows }
          : { status: 'ok' as const, expanded: records.records.map((held) => wireExpanded(held, input.fields)) };
      }),
    }),
  ),

  read_thread_rollout: pair(
    OPS.read_thread_rollout,
    body(OPS.read_thread_rollout, {
      execute: Effect.fnUntraced(function* (input) {
        const rollout = yield* answering(
          'read_thread_rollout',
          Effect.gen(function* () {
            const project = (yield* yield* CurrentProject).project.id;
            return yield* (yield* ThreadRollouts).report(input.threadId, project, input.records);
          }),
        );
        return { status: 'ok' as const, rollout };
      }),
    }),
  ),
};

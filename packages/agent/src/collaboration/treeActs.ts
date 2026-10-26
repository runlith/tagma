import { type Context, Effect } from 'effect';
import { RunAdmission } from '../thread/run/runAdmission';
import { ThreadRuns } from './runs';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { Raised } from '../permissions/vocabulary';
import type { KeyedRequest } from '../thread/keyed';
import { historyCannot, threadTarget, type ThreadRecord } from '../thread/record';
import type { ThreadRewindAsk } from '../thread/rewind';
import { ThreadRewind } from '../thread/run/ThreadRewind';
import type { ThreadCompactionPoint } from '../thread/storage/inbox';
import { ContextCompaction, ThreadCompactionRefused } from './compaction';
import { movedModel } from './modelChoice';
import { ThreadModel, ThreadModelConflict, ThreadModelRefused } from './model';
import { carryModelMove } from './modelCarry';
import { planeRefused, transportCannot } from './planeRefusal';
import { crossed, crossing, reach, stopperOf, type Within } from './reach';
import type {
  ThreadChildCompacted,
  ThreadChildContinued,
  ThreadChildMoved,
  ThreadChildRewound,
  ThreadChildSpent,
  ThreadChildStopped,
  ThreadChildSummary,
  ThreadModelAsk,
  ThreadPlaneFailure,
} from './ThreadPlaneAccess';
import { Threads } from './threads';

export type TreeAsk = { readonly threadId: string; readonly key: string; readonly asked?: readonly string[] };

export type CompactAsk = TreeAsk & { readonly keep?: string; readonly at?: ThreadCompactionPoint; readonly wake?: boolean };

const CHILD_PAGE = 200;

export type TreeActs = Effect.Success<ReturnType<typeof makeTreeActs>>;

export const makeTreeActs = Effect.fnUntraced(function* ({
  catalog,
  request,
}: {
  readonly catalog: () => ModelCatalog;
  readonly request: (key: string) => Effect.Effect<KeyedRequest>;
}) {
  const threads = yield* Threads;
  const runs = yield* ThreadRuns;
  const models = yield* ThreadModel;
  const compaction = yield* ContextCompaction;
  const rewinds = yield* ThreadRewind;
  const admission = yield* RunAdmission;

  const crossTo = (caller: ThreadRecord, ask: TreeAsk, within: Within) =>
    Effect.flatMap(reach(threads, caller, ask.threadId), (reached) => crossed(reached, ask.threadId, within, ask.asked ?? []));

  const compactable = Effect.fnUntraced(function* (caller: ThreadRecord, ask: TreeAsk): Effect.fn.Return<ThreadRecord, ThreadPlaneFailure> {
    const { thread } = yield* crossTo(caller, ask, 'descendant');
    if (thread.capabilities.compaction === 'none') return yield* transportCannot(thread, 'compaction');
    return thread;
  });

  return {
    crossing: (caller: ThreadRecord, threadId: string, within: Within): Effect.Effect<readonly Raised[], ThreadPlaneFailure> =>
      Effect.map(reach(threads, caller, threadId), (reached) => crossing(reached, within)),

    stop: Effect.fnUntraced(function* (caller: ThreadRecord, ask: TreeAsk): Effect.fn.Return<ThreadChildStopped, ThreadPlaneFailure> {
      const reached = yield* crossTo(caller, ask, 'child');
      const stopped = yield* runs.stop(reached.thread.id, {
        request: yield* request(ask.key),
        by: stopperOf(reached),
      });
      return { ...threadTarget(reached.thread), status: stopped.status };
    }),

    continue: Effect.fnUntraced(function* (caller: ThreadRecord, ask: TreeAsk): Effect.fn.Return<ThreadChildContinued, ThreadPlaneFailure> {
      const { thread } = yield* crossTo(caller, ask, 'child');
      const continued = yield* runs.continue(thread.id, { request: yield* request(ask.key) });
      return { ...threadTarget(thread), ...(continued.status === 'spent' ? continued : { runId: continued.runId }) };
    }),

    move: Effect.fnUntraced(function* (
      caller: ThreadRecord,
      ask: TreeAsk & { readonly model: ThreadModelAsk },
    ): Effect.fn.Return<ThreadChildMoved | ThreadChildSpent, ThreadPlaneFailure> {
      const { thread } = yield* crossTo(caller, ask, 'child');
      if (thread.capabilities.modelMove === 'pinned') {
        return yield* planeRefused(
          'model-pinned',
          `thread ${thread.id} is a collaborator the product runs itself, and its model was fixed at its birth. ` +
            'Start a new agent on the model you need, with this one’s report as its brief.',
        );
      }
      const asked = ask.model;
      if (asked.provider === undefined && asked.model === undefined && asked.reasoning === undefined) {
        return yield* planeRefused('selection-empty', `name the provider, the model or the reasoning rung to move ${thread.id} to.`);
      }
      if (thread.model === null)
        return yield* planeRefused('model-unnamed', `thread ${thread.id} carries no model this host can move it from.`);
      const judged = yield* movedModel(catalog(), thread.model, asked);
      const keyed = yield* request(ask.key);
      const stopped = yield* runs.stopReceipt(thread.id, ask.key);
      if (stopped?.status === 'spent') return { ...threadTarget(thread), ...stopped };
      const { moved, runId } = yield* carryModelMove({
        threadId: thread.id,
        request: keyed,
        stopped,
        self: thread.id === caller.id,
        move: (resume) => models.move(thread.id, { request: keyed, option: judged.option, reasoning: judged.reasoning, resume }),
        running: (failure) => failure instanceof ThreadModelRefused && failure.reason === 'thread-running',
      }).pipe(
        Effect.provideService(ThreadRuns, runs),
        Effect.provideService(RunAdmission, admission),
        Effect.catchIf(
          (failure): failure is ThreadModelConflict => failure instanceof ThreadModelConflict,
          () => Effect.fail(planeRefused('key-reused', `This key already moved ${thread.id} to another choice.`)),
        ),
        Effect.catchIf(
          (failure): failure is ThreadModelRefused =>
            failure instanceof ThreadModelRefused && (failure.reason === 'self-move' || failure.reason === 'step-unreached'),
          (failure) =>
            Effect.fail(
              failure.reason === 'self-move'
                ? planeRefused('self-move', 'This call cannot wait for the next step of its own run.')
                : planeRefused('thread-running', 'The child did not reach a step boundary within this call’s window.'),
            ),
        ),
      );
      if (moved.status === 'spent') return { ...threadTarget(thread), ...moved };
      return {
        ...threadTarget(thread),
        from: moved.from,
        to: moved.to,
        lowered: judged.lowered,
        runId,
      };
    }),

    compactable,

    compact: Effect.fnUntraced(function* (
      caller: ThreadRecord,
      ask: CompactAsk,
    ): Effect.fn.Return<ThreadChildCompacted | ThreadChildSpent, ThreadPlaneFailure> {
      const thread = yield* compactable(caller, ask);
      const compacted = yield* compaction
        .compact(thread.id, {
          request: yield* request(ask.key),
          keep: ask.keep,
          at: ask.at,
        })
        .pipe(
          Effect.catchIf(
            (failure): failure is ThreadCompactionRefused => failure instanceof ThreadCompactionRefused && failure.reason === 'running',
            (refused) => Effect.fail(pointMissing(thread.id, refused.running?.runId)),
          ),
        );
      switch (compacted.status) {
        case 'spent':
        case 'joined':
          return { ...threadTarget(thread), ...compacted };
        case 'requested':
          return { ...threadTarget(thread), status: 'requested', requestId: compacted.requestId, at: compacted.at, runId: compacted.runId };
        default:
          return {
            ...threadTarget(thread),
            status: compacted.status,
            runId: compacted.runId,
            history: compacted.history,
            summarizer: compacted.summarizer,
            skipped: compacted.skipped,
          };
      }
    }),

    rewind: Effect.fnUntraced(function* (
      caller: ThreadRecord,
      ask: TreeAsk & ThreadRewindAsk,
    ): Effect.fn.Return<ThreadChildRewound, ThreadPlaneFailure> {
      const reached = yield* crossTo(caller, ask, 'descendant');
      const cannot = historyCannot(reached.thread.capabilities, 'point');
      if (cannot !== null) return yield* transportCannot(reached.thread, cannot);
      const rewound = yield* rewinds.rewind(reached.thread.id, reached.thread.principal, {
        at: ask.at,
        scope: ask.scope,
        call: { actor: caller.id, key: ask.key },
        by: stopperOf(reached),
      });
      return { ...threadTarget(reached.thread), ...rewound };
    }),
  };
});

export const childrenOf = Effect.fnUntraced(function* (
  threads: Context.Service.Shape<typeof Threads>,
  principal: string,
  parentThreadId: string,
): Effect.fn.Return<readonly ThreadChildSummary[], ThreadPlaneFailure> {
  const children: ThreadChildSummary[] = [];
  let cursor: Parameters<(typeof threads)['list']>[0]['cursor'] | null = null;
  do {
    const page: Effect.Success<ReturnType<(typeof threads)['list']>> = yield* threads.list({
      principal,
      from: parentThreadId,
      parent: parentThreadId,
      limit: CHILD_PAGE,
      cursor: cursor ?? undefined,
    });
    for (const row of page.rows) {
      children.push({
        threadId: row.threadId,
        agentId: row.agentId,
        status: row.run !== null ? 'running' : row.assignment === 'failed' ? 'failed' : 'idle',
      });
    }
    cursor = page.cursor;
  } while (cursor !== null);
  return children;
});

function pointMissing(threadId: string, runId: string | undefined) {
  return planeRefused(
    'thread-running',
    `${runId === undefined ? 'a run' : `run ${runId}`} of ${threadId} is going; ` +
      "name `at` to ask for its compaction — 'step' at its next step, 'end' once the work already queued for it is done — " +
      'and the request is answered at once, without waiting for the summary.',
  );
}

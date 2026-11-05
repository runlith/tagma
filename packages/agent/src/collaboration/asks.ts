import { Clock, Effect, Exit } from 'effect';
import type { ModelOption } from '@runlith/llm/models/catalog';
import type { ThreadBornOf } from '../protocol/birth';
import type { ThreadRecord } from '../thread/record';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import { causeSentence } from '../thread/persisted';
import { ASK_QUESTIONS_MAX, DEFAULT_READER, type ThreadAskAsk, type ThreadAskEntry, type ThreadAsked } from './askVerbs';
import { bornElsewhere } from './collaborationVerbs';
import { DeclaredCollaboration } from './CollaborationConfig';
import { planeRefused } from './planeRefusal';
import type { ThreadWaitArrival } from './arrivals';
import { ThreadDirectory, type ThreadDirectoryAssignment } from './ThreadDirectory';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import type { ThreadModelAsk, ThreadPlaneFailure } from './ThreadPlaneAccess';
import { ThreadSpawnTree } from './ThreadSpawnTree';
import { Threads } from './threads';
import type { TreeActs } from './treeActs';
import { ThreadTypes } from './types';

const NO_DEADLINE_MS = 2 ** 40;

const CACHE_MARGIN_SECONDS = 30;

const ENDED_BADLY: ReadonlySet<ThreadDirectoryAssignment> = new Set(['failed', 'cut', 'aborted']);

type Reader = { readonly id: string; readonly projectId?: number };

function readerSeconds(promised: number | null): number | undefined {
  return promised === null ? undefined : Math.max(1, promised - CACHE_MARGIN_SECONDS);
}

function entryOf(
  question: string,
  reader: Reader,
  arrival: ThreadWaitArrival | undefined,
  assignment: ThreadDirectoryAssignment | undefined,
  failureReason: string | null,
): ThreadAskEntry {
  const shared = { question, threadId: reader.id, ...(reader.projectId === undefined ? {} : { projectId: reader.projectId }) };
  if (arrival === undefined) {
    return {
      ...shared,
      status: 'failed',
      text: failureReason ?? `the reader ended ${assignment ?? 'without a report'} and gave no answer`,
    };
  }
  const failed = assignment !== undefined && ENDED_BADLY.has(assignment);
  return { ...shared, status: failed ? 'failed' : 'answered', text: arrival.text };
}

export type Asks = Effect.Success<ReturnType<typeof makeAsks>>;

export const makeAsks = Effect.fnUntraced(function* ({ acting }: { readonly acting: TreeActs }) {
  const config = yield* DeclaredCollaboration;
  const directory = yield* ThreadDirectory;
  const messaging = yield* ThreadEnvelopes;
  const tree = yield* ThreadSpawnTree;
  const threads = yield* Threads;
  const types = yield* ThreadTypes;

  const lightModel = (parent: ThreadRecord): ThreadModelAsk | undefined => {
    const standing = parent.model;
    if (standing === null || config === null) return undefined;
    const catalog = config.models();
    if (!catalog.registered(standing.provider)) return undefined;
    const light = catalog.named(standing.provider).lightTextModel;
    return light === undefined ? undefined : { provider: standing.provider, model: light.model, reasoning: light.rung };
  };

  const callerOption = (parent: ThreadRecord): ModelOption | undefined => {
    const standing = parent.model;
    if (standing === null || config === null || !config.models().registered(standing.provider)) return undefined;
    return config.models().findTextModel(standing.provider, standing.model);
  };

  const ask = Effect.fn('ThreadAsks.ask')(function* (
    parent: ThreadRecord,
    runId: string | undefined,
    input: ThreadAskAsk,
  ): Effect.fn.Return<ThreadAsked, ThreadPlaneFailure> {
    if (config === null)
      return yield* new ThreadCallBroke({ cause: new Error('This host declared no collaboration, so nothing here can ask.') });
    if (input.questions.length === 0 || input.questions.length > ASK_QUESTIONS_MAX) {
      return yield* new ThreadCallBroke({ cause: new Error(`Ask between 1 and ${ASK_QUESTIONS_MAX} questions in one call.`) });
    }
    const configured = config.readers === undefined ? undefined : yield* config.readers.agent(parent);
    const agentId = input.agentId ?? configured ?? DEFAULT_READER;
    const home =
      input.project === undefined
        ? undefined
        : config.placement === undefined
          ? yield* planeRefused('home-unplaced', 'this host places no child in another project; ask without `project`.')
          : bornElsewhere(yield* config.placement.home(parent, input.project));
    const offer = yield* types.resolve({
      caller: 'agent',
      under: parent,
      typeId: agentId,
      ...(home === undefined ? {} : { project: home }),
    });
    const defined = offer !== null && !('withheld' in offer) ? offer : null;
    const named = defined?.profile?.model;
    const light = named?.provider === undefined && named?.model === undefined ? lightModel(parent) : undefined;
    const model = light === undefined || named?.reasoning === undefined ? light : { ...light, reasoning: named.reasoning };
    const secondsCap = readerSeconds(callerOption(parent)?.cacheLifetime.promisedSeconds ?? null);
    const bornOf: ThreadBornOf = {
      ...(runId === undefined || input.step === undefined ? { by: input.requestId, step: 0 } : { by: runId, step: input.step }),
      ask: true,
    };
    const readers: Reader[] = [];
    const failures = new Map<number, unknown>();
    const born = Effect.map(
      Effect.forEach(input.questions, (_, position) => threads.birthReceipt(parent.id, `${input.requestId}:${position}`), {
        concurrency: 'unbounded',
      }),
      (receipts) => receipts.flatMap((receipt) => (receipt === null ? [] : [receipt.threadId])),
    );
    const stopReaders = Effect.flatMap(born, (ids) =>
      Effect.flatMap(
        Effect.forEach(ids, (threadId) => Effect.exit(acting.stop(parent, { threadId, key: `${input.requestId}:stop:${threadId}` })), {
          concurrency: 'unbounded',
        }),
        (exits) => {
          const failed = exits.find(Exit.isFailure);
          return failed === undefined ? Effect.void : Effect.failCause(failed.cause);
        },
      ),
    );

    const collected = Effect.gen(function* () {
      for (const [position, question] of input.questions.entries()) {
        const birth = yield* Effect.result(
          tree.spawn({
            parent,
            runId,
            bornOf,
            requestId: `${input.requestId}:${position}`,
            agentId,
            task: question,
            delegation: true,
            reportDelivery: 'collect',
            model,
            project: input.project,
            worktree: input.worktree,
            secondsCap,
          }),
        );
        if (birth._tag === 'Success') readers.push({ id: birth.success.threadId, projectId: birth.success.projectId });
        else failures.set(position, birth.failure);
      }
      if (readers.length === 0) return yield* Effect.fail([...failures.values()][0] as ThreadPlaneFailure);
      const sender = { id: parent.id, principal: parent.principal };
      const ids = readers.map((reader) => reader.id);
      const since = new Date(yield* Clock.currentTimeMillis);
      const reports = yield* messaging.access(sender, runId).collect({ from: ids, deadlineMs: NO_DEADLINE_MS, since });
      const standing = yield* directory.access(sender).list({ ids, limit: ids.length });
      const endings = new Map(standing.rows.map((row) => [row.threadId, row] as const));
      const byPosition = new Map<number, Reader>();
      let next = 0;
      for (let position = 0; position < input.questions.length; position += 1) {
        if (!failures.has(position)) byPosition.set(position, readers[next++]!);
      }
      return input.questions.map((question, position): ThreadAskEntry => {
        const reader = byPosition.get(position);
        if (reader === undefined) {
          return { question, status: 'failed', text: causeSentence(failures.get(position)), threadId: null };
        }
        const row = endings.get(reader.id);
        return entryOf(question, reader, reports.get(reader.id), row?.assignment, row?.failureReason ?? null);
      });
    }).pipe(Effect.onError(() => Effect.orDie(stopReaders)));

    const entries = yield* collected;
    const archived = config.readers === undefined ? undefined : yield* Effect.result(config.readers.archive(yield* born));
    return {
      status: 'asked',
      entries,
      ...(archived?._tag === 'Failure' ? { unarchived: causeSentence(archived.failure) } : {}),
    };
  });

  return { ask };
});

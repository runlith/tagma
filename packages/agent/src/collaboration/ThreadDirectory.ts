import { Clock, Context, Effect, Layer } from 'effect';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { agentSpan } from '../agent/spans';
import type { ThreadFailureDiagnostics } from '../transcript/entries';
import type { ThreadRunStatus } from '../thread/rows';
import { occupiedTokens, type ThreadContextLimit, type ThreadLimitSubject } from '../thread/compaction/limit';
import { ThreadCacheCurve } from '../thread/cache/ThreadCacheCurve';
import { type ThreadCacheWarmth, nextRequestWarmth } from '../thread/cache/ThreadCacheWarmth';
import type { Cursor } from '@runlith/paging';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import type { ThreadReadFailure } from '../thread/record';
import type { CurrentRun } from '../thread/record';
import { type CollaborationWarmth, DeclaredCollaboration, type ThreadWarmthSubject } from './CollaborationConfig';
import { type ThreadDirectoryRow, Threads } from './threads';
export type ThreadDirectoryAssignment = ThreadRunStatus | 'never-started';
export type ThreadDirectoryContext = {
  readonly tokens: number;
  readonly limit: ThreadContextLimit | null;
  readonly window: number | null;
  readonly stale: boolean;
};
export type ThreadDirectoryEntry = {
  readonly threadId: string;
  readonly projectId: number | null;
  readonly agentId: string;
  readonly name: string | null;
  readonly spawnRootId: string;
  readonly parentThreadId: string | null;
  readonly selection: ThreadDirectoryRow['selection'];
  readonly assignment: ThreadDirectoryAssignment;
  readonly failureReason: string | null;
  readonly failure: ThreadFailureDiagnostics | null;
  readonly life: CurrentRun['life'] | 'idle';
  readonly askPrompt: string | null;
  readonly context: ThreadDirectoryContext | null;
  readonly warmth: ThreadCacheWarmth | null;
  readonly movedAt: string;
  readonly stalledSince: string | null;
};
export type ThreadDirectoryAccess = {
  list(query: { readonly ids?: readonly string[]; readonly limit: number; readonly cursor?: Cursor }): Effect.Effect<
    {
      readonly rows: readonly ThreadDirectoryEntry[];
      readonly total: number;
      readonly cursor: Cursor | null;
    },
    ThreadBorderFailed | ThreadReadFailure
  >;
};
export class ThreadDirectory extends Context.Service<
  ThreadDirectory,
  {
    access(thread: { readonly id: string; readonly principal: string }): ThreadDirectoryAccess;
    warmth(subjects: readonly ThreadWarmthSubject[]): Effect.Effect<readonly (ThreadCacheWarmth | null)[], ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadDirectory') {}
function restingSubject(row: ThreadDirectoryRow): ThreadWarmthSubject | null {
  if (row.run !== null || row.contextReading === null || row.selection === null) return null;
  return { contextReading: row.contextReading, ...row.selection };
}
function limitSubject(row: ThreadDirectoryRow): ThreadLimitSubject | null {
  if (row.projectId === null || row.provider === null || row.contextReading === null) return null;
  return {
    id: row.threadId,
    projectId: row.projectId,
    agentId: row.agentId,
    provider: row.provider,
    model: row.selection?.model ?? null,
    capabilities: row.capabilities,
    contextReading: row.contextReading,
    activeRun: row.run === null ? null : { id: row.run.runId },
  };
}
function catalogWarmth(models: () => ModelCatalog, curves: Context.Service.Shape<typeof ThreadCacheCurve>): CollaborationWarmth {
  return Effect.fnUntraced(function* (resting) {
    const read = yield* curves.of([...new Set(resting.map((subject) => subject.provider))]);
    const curveOf = new Map(read.map((curve) => [curve.provider, curve] as const));
    const now = yield* Clock.currentTimeMillis;
    return resting.map(({ contextReading, ...next }) =>
      nextRequestWarmth({ reading: contextReading, next, models: models(), curve: curveOf.get(next.provider) ?? null, now }),
    );
  });
}
export const threadDirectoryLayer = Layer.effect(
  ThreadDirectory,
  Effect.gen(function* () {
    const threads = yield* Threads;
    const curves = yield* ThreadCacheCurve;
    const collaboration = yield* DeclaredCollaboration;
    const warmth = collaboration === null ? undefined : (collaboration.warmth ?? catalogWarmth(collaboration.models, curves));
    return ThreadDirectory.of({
      warmth: (subjects) => (warmth === undefined || subjects.length === 0 ? Effect.succeed(subjects.map(() => null)) : warmth(subjects)),
      access: (thread) => ({
        list: Effect.fnUntraced(
          function* (query) {
            if (query.ids?.length === 0) return { rows: [], total: 0, cursor: null };
            const listed = yield* threads.list({ ...query, principal: thread.principal, from: thread.id });
            const read = listed.rows.map((row) => {
              const life: CurrentRun['life'] | 'idle' = row.run?.life ?? 'idle';
              return { row, life, resting: restingSubject(row) };
            });
            const resting = read.flatMap(({ resting }) => (resting === null ? [] : [resting]));
            const verdicts = warmth === undefined || resting.length === 0 ? [] : yield* warmth(resting);
            const judged = new Map(resting.map((subject, index) => [subject, verdicts[index] ?? null] as const));
            const measured = listed.rows.flatMap((row) => {
              const subject = limitSubject(row);
              return subject === null ? [] : [subject];
            });
            const limits = collaboration?.limits === undefined || measured.length === 0 ? null : yield* collaboration.limits(measured);
            const rows = read.map(({ row, life, resting }) => ({
              threadId: row.threadId,
              projectId: row.projectId,
              agentId: row.typeId,
              name: row.name,
              spawnRootId: row.spawnRootId,
              parentThreadId: row.parentThreadId,
              selection: row.selection,
              assignment: row.assignment ?? ('never-started' as const),
              failureReason: row.failureReason,
              failure: row.failure,
              life,
              askPrompt: row.run?.askPrompt ?? null,
              context:
                row.contextReading === null
                  ? null
                  : {
                      tokens: occupiedTokens(row.contextReading.usage) ?? 0,
                      limit: limits?.get(row.threadId) ?? null,
                      window: row.contextReading.contextWindow,
                      stale: row.contextReading.stale,
                    },
              warmth: resting === null ? null : (judged.get(resting) ?? null),
              movedAt: row.movedAt.toISOString(),
              stalledSince: row.run?.stalledSince?.toISOString() ?? null,
            }));
            return { ...listed, rows };
          },
          (effect, query) => effect.pipe(agentSpan({ type: 'directory', threadId: thread.id })),
        ),
      }),
    });
  }),
);

import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { actorOfPrincipal, principalOf } from '../../executions/terminals/principals.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Units, WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { MergeAfter, MergeMode } from '../../worktrees/contract/wire/mergeTypes.js';
import type { MergedAfter } from '../../worktrees/contract/wire/entries.js';
import type { Intent } from './intentLifecycle.js';
import { type IntentPhase, landingIntent, type MergeAfterState, type MergeSourceState, mergeRequest } from './tables.js';

export type MergeRequestRow = {
  readonly request: string;
  readonly rootId: RootId;
  readonly baseRootId: RootId;
  readonly name: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly mode: MergeMode;
  readonly source: string;
  readonly after: MergeAfter;
  readonly end: Principal | null;
  readonly caller: TerminalActor | null;
  readonly waitedSince: Date | null;
  readonly afterState: MergeAfterState;
  readonly afterDone: MergedAfter | null;
  readonly sourcePath: string;
  readonly sourceState: MergeSourceState;
  readonly sourceReason: string | null;
  readonly rulesAfter: boolean;
};

export type OpenWitness = {
  readonly phase: IntentPhase;
  readonly repository: string;
  readonly checkout: string;
  readonly ref: string;
  readonly commit: string | null;
};

export type MergeRequests = {
  readonly intend: (intent: Intent, request: MergeRequestRow) => Effect.Effect<void, StoreFailure>;
  readonly of: (keys: readonly string[]) => Effect.Effect<ReadonlyMap<string, MergeRequestRow>, StoreFailure>;
  readonly afterRunning: (key: string) => Effect.Effect<void, StoreFailure>;
  readonly afterDone: (key: string, after: MergedAfter) => Effect.Effect<void, StoreFailure>;
  readonly sourceSettled: (key: string, state: MergeSourceState, reason: string | null) => Effect.Effect<void, StoreFailure>;
  readonly rulesTold: (key: string) => Effect.Effect<void, StoreFailure>;
  readonly tailOpen: (rootId: string) => Effect.Effect<readonly OpenWitness[], StoreFailure>;
  readonly close: (unit: WriteUnit<'machine'>, key: string) => Effect.Effect<void, StoreFailure>;
};

const intending = writes('landing.mergeIntend', [landingIntent, mergeRequest]);
const afterMarking = writes('landing.mergeAfter', [mergeRequest]);

const rowOf = (row: typeof mergeRequest.$inferSelect & { readonly projectId: number }): MergeRequestRow => ({
  request: row.request,
  rootId: RootId.make(row.rootId),
  baseRootId: RootId.make(row.baseRootId),
  name: row.name,
  branch: row.branch,
  baseBranch: row.baseBranch,
  mode: row.mode,
  source: row.source,
  after: row.after,
  end: row.end === null ? null : Principal.make(row.end),
  caller: row.caller === null ? null : actorOfPrincipal(Principal.make(row.caller), row.callerProjectId ?? row.projectId),
  waitedSince: row.waitedSince,
  afterState: row.afterState,
  afterDone: row.afterOutcome === null ? null : { act: row.after, outcome: row.afterOutcome, reason: row.afterReason },
  sourcePath: row.sourcePath,
  sourceState: row.sourceState,
  sourceReason: row.sourceReason,
  rulesAfter: row.rulesAfter,
});

export const mergeRequests = (db: StoreDb<'machine'>, units: Units<'machine'>): MergeRequests => ({
  intend: (intent, request) =>
    units.write(intending, (unit) =>
      Effect.andThen(
        unit.run(db.insert(landingIntent).values(intent)),
        unit.run(
          db.insert(mergeRequest).values({
            key: intent.key,
            request: request.request,
            rootId: request.rootId,
            baseRootId: request.baseRootId,
            name: request.name,
            branch: request.branch,
            baseBranch: request.baseBranch,
            mode: request.mode,
            source: request.source,
            after: request.after,
            end: request.end,
            caller: request.caller === null ? null : principalOf(request.caller),
            callerProjectId: request.caller === null || request.caller._tag === 'Operator' ? null : request.caller.projectId,
            waitedSince: request.waitedSince,
            afterState: request.afterState,
            afterOutcome: null,
            afterReason: null,
            sourcePath: request.sourcePath,
            sourceState: request.sourceState,
            sourceReason: null,
            rulesAfter: false,
          }),
        ),
      ).pipe(Effect.asVoid),
    ),
  of: (keys) =>
    keys.length === 0
      ? Effect.succeed(new Map())
      : units.read((unit) =>
          Effect.map(
            unit.run(
              db
                .select({ ...getTableColumns(mergeRequest), projectId: landingIntent.projectId })
                .from(mergeRequest)
                .innerJoin(landingIntent, eq(mergeRequest.key, landingIntent.key))
                .where(inArray(mergeRequest.key, [...keys]))
                .all(),
            ),
            (rows) => new Map(rows.map((row) => [row.key, rowOf(row)])),
          ),
        ),
  afterRunning: (key) =>
    units.write(afterMarking, (unit) =>
      Effect.asVoid(
        unit.run(
          db
            .update(mergeRequest)
            .set({ afterState: 'running' })
            .where(and(eq(mergeRequest.key, key), eq(mergeRequest.afterState, 'waiting'))),
        ),
      ),
    ),
  afterDone: (key, after) =>
    units.write(afterMarking, (unit) =>
      Effect.asVoid(
        unit.run(
          db
            .update(mergeRequest)
            .set({ afterState: 'done', afterOutcome: after.outcome, afterReason: after.reason })
            .where(eq(mergeRequest.key, key)),
        ),
      ),
    ),
  sourceSettled: (key, state, reason) =>
    units.write(afterMarking, (unit) =>
      Effect.asVoid(unit.run(db.update(mergeRequest).set({ sourceState: state, sourceReason: reason }).where(eq(mergeRequest.key, key)))),
    ),
  rulesTold: (key) =>
    units.write(afterMarking, (unit) =>
      Effect.asVoid(unit.run(db.update(mergeRequest).set({ rulesAfter: true }).where(eq(mergeRequest.key, key)))),
    ),
  tailOpen: (rootId) =>
    units.read((unit) =>
      unit.run(
        db
          .select({
            phase: landingIntent.phase,
            repository: landingIntent.repository,
            checkout: landingIntent.checkout,
            ref: landingIntent.ref,
            commit: landingIntent.commit,
          })
          .from(mergeRequest)
          .innerJoin(landingIntent, eq(landingIntent.key, mergeRequest.key))
          .where(and(eq(mergeRequest.rootId, rootId), inArray(landingIntent.phase, ['publishing', 'published'])))
          .all(),
      ),
    ),
  close: (unit, key) =>
    Effect.asVoid(
      unit.run(
        db
          .update(landingIntent)
          .set({ phase: 'settled' })
          .where(and(eq(landingIntent.key, key), inArray(landingIntent.phase, ['publishing', 'published']))),
      ),
    ),
});

import { Effect } from 'effect';
import { type WorkflowLease, type WorkflowRun, amendmentProblems, workflowRunSchema } from '@runlith/agent/workflow/run';
import type { WorkflowRunStorage } from '@runlith/agent/workflow/storage';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import { desc, eq } from 'drizzle-orm';
import { Schema } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { recordFacts } from '../../thread-record/facts.js';
import { workflowRun } from '../../threads/store/workflow.js';

const decodeRun = Schema.decodeUnknownResult(workflowRunSchema);

export type WorkflowRuns = WorkflowRunStorage & {
  readonly ofProject: (projectId: number) => Effect.Effect<readonly WorkflowRun[], ThreadPortFailure>;
};

export const makeWorkflowRuns = Effect.gen(function* (): Effect.fn.Return<WorkflowRuns, never, MachineStore | MachineUnits> {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const read = <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, unknown>): Effect.Effect<A, ThreadPortFailure> =>
    Effect.mapError(units.read(work), (cause) => new ThreadStorageFailed({ call: 'WorkflowRuns.read', cause }));

  const write = <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, unknown>): Effect.Effect<A, ThreadPortFailure> =>
    Effect.mapError(
      units.write(writes('WorkflowRuns.write', [workflowRun]), work),
      (cause) => new ThreadStorageFailed({ call: 'WorkflowRuns.write', cause }),
    );

  const rowOf = (unit: Unit<'machine'>, runId: string) => unit.run(db.select().from(workflowRun).where(eq(workflowRun.id, runId)).get());

  return {
    start: (input) =>
      Effect.map(
        write((unit) =>
          Effect.gen(function* () {
            const facet = yield* unit.run(
              db.select({ projectId: recordFacts.projectId }).from(recordFacts).where(eq(recordFacts.id, input.thread)).get(),
            );
            if (!facet || facet.projectId === null) {
              return yield* Effect.fail(new Error(`Workflow run ${input.id} names thread ${input.thread}, which is not a Tagma thread.`));
            }
            return yield* unit.run(
              db
                .insert(workflowRun)
                .values({
                  id: input.id,
                  workflow: input.workflow,
                  thread: input.thread,
                  projectId: facet.projectId,
                  plan: input.plan,
                  input: input.input,
                  records: [],
                })
                .returning()
                .get(),
            );
          }),
        ),
        (row) => {
          if (!row) throw new Error(`Workflow run ${input.id} was not written.`);
          return runOf(row);
        },
      ),

    ofProject: (projectId) =>
      Effect.map(
        read((unit) =>
          unit.run(db.select().from(workflowRun).where(eq(workflowRun.projectId, projectId)).orderBy(desc(workflowRun.createdAt))),
        ),
        (rows) => rows.map(runOf),
      ),

    find: (runId) =>
      Effect.map(
        read((unit) => rowOf(unit, runId)),
        (row) => (row ? runOf(row) : undefined),
      ),

    dispatch: (runId, record, lease) =>
      write((unit) =>
        Effect.gen(function* () {
          const row = yield* rowOf(unit, runId);
          if (!row || !holds(row, lease)) return false;
          const standing = row.records.some((held) => held.stepId === record.stepId && held.attempt === record.attempt);
          if (standing) return false;
          yield* unit.run(
            db
              .update(workflowRun)
              .set({ records: [...row.records, record] })
              .where(eq(workflowRun.id, runId)),
          );
          return true;
        }),
      ),

    settleStep: (runId, input, lease) =>
      write((unit) =>
        Effect.gen(function* () {
          const row = yield* rowOf(unit, runId);
          if (!row || !holds(row, lease)) return false;
          if (!row.records.some((record) => record.stepId === input.stepId && record.attempt === input.attempt)) {
            return false;
          }
          const records = row.records.map((record) =>
            record.stepId === input.stepId && record.attempt === input.attempt
              ? {
                  ...record,
                  status: input.status,
                  output: input.output ?? record.output,
                  next: input.next === undefined ? record.next : input.next,
                  reason: input.reason ?? record.reason,
                }
              : record,
          );
          yield* unit.run(db.update(workflowRun).set({ records }).where(eq(workflowRun.id, runId)));
          return true;
        }),
      ),

    amend: (runId, input) =>
      write((unit) =>
        Effect.gen(function* () {
          const row = yield* rowOf(unit, runId);
          if (!row || row.plan.revision !== input.fromRevision) return 'stale' as const;
          if (amendmentProblems(runOf(row), input.plan).length > 0) return 'stale' as const;
          yield* unit.run(db.update(workflowRun).set({ plan: input.plan }).where(eq(workflowRun.id, runId)));
          return 'amended' as const;
        }),
      ),

    lease: (runId, input) =>
      write((unit) =>
        Effect.gen(function* () {
          const row = yield* rowOf(unit, runId);
          if (!row) return undefined;
          if (row.lease !== null && row.lease.until > input.now) return undefined;
          const lease = { owner: input.owner, until: input.until, token: (row.lease?.token ?? 0) + 1 };
          yield* unit.run(db.update(workflowRun).set({ lease }).where(eq(workflowRun.id, runId)));
          return lease;
        }),
      ),

    renew: (runId, lease, input) =>
      write((unit) =>
        Effect.gen(function* () {
          const row = yield* rowOf(unit, runId);
          if (!row || !holds(row, lease)) return false;
          yield* unit.run(
            db
              .update(workflowRun)
              .set({ lease: { ...lease, until: input.until } })
              .where(eq(workflowRun.id, runId)),
          );
          return true;
        }),
      ),

    finish: (runId, input, lease) =>
      write((unit) =>
        Effect.gen(function* () {
          const row = yield* rowOf(unit, runId);
          if (!row || !holds(row, lease)) return false;
          yield* unit.run(
            db
              .update(workflowRun)
              .set({ status: input.status, reason: input.reason ?? null })
              .where(eq(workflowRun.id, runId)),
          );
          return true;
        }),
      ),
  };
});

function runOf(row: typeof workflowRun.$inferSelect): WorkflowRun {
  const parsed = decodeRun({
    id: row.id,
    workflow: row.workflow,
    thread: row.thread,
    plan: row.plan,
    input: row.input,
    status: row.status,
    lease: row.lease,
    records: row.records,
    reason: row.reason,
  });
  if (parsed._tag !== 'Success') throw new Error(`Workflow run ${row.id} does not parse: ${parsed.failure.message}`);
  return parsed.success;
}

function holds(row: typeof workflowRun.$inferSelect, lease: WorkflowLease): boolean {
  return row.lease !== null && row.lease.token === lease.token;
}

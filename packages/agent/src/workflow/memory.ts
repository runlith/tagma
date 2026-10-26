import { attempt } from '../thread/storage/memory/attempt';
import { amendmentProblems, type WorkflowLease, type WorkflowRun } from './run';
import type { WorkflowRunStorage } from './storage';

export function makeWorkflowRuns(): WorkflowRunStorage {
  const runs = new Map<string, WorkflowRun>();
  return {
    start: (input) =>
      attempt('start', () => {
        const run: WorkflowRun = {
          id: input.id,
          workflow: input.workflow,
          thread: input.thread,
          plan: input.plan,
          input: input.input,
          status: 'running',
          lease: null,
          records: [],
          reason: null,
        };
        runs.set(run.id, run);
        return run;
      }),
    find: (runId) => attempt('find', () => runs.get(runId)),
    lease: (runId, input) =>
      attempt('lease', () => {
        const run = runs.get(runId);
        if (!run) return undefined;
        if (run.lease !== null && run.lease.until > input.now) return undefined;
        const lease: WorkflowLease = { owner: input.owner, until: input.until, token: (run.lease?.token ?? 0) + 1 };
        runs.set(runId, { ...run, lease });
        return lease;
      }),
    renew: (runId, lease, input) =>
      attempt('renew', () => {
        const run = runs.get(runId);
        if (!run || !holds(run, lease)) return false;
        runs.set(runId, { ...run, lease: { ...lease, until: input.until } });
        return true;
      }),
    dispatch: (runId, record, lease) =>
      attempt('dispatch', () => {
        const run = runs.get(runId);
        if (!run || !holds(run, lease)) return false;
        const standing = run.records.some((held) => held.stepId === record.stepId && held.attempt === record.attempt);
        if (standing) return false;
        runs.set(runId, { ...run, records: [...run.records, record] });
        return true;
      }),
    settleStep: (runId, input, lease) =>
      attempt('settleStep', () => {
        const run = runs.get(runId);
        if (!run || !holds(run, lease)) return false;
        if (!run.records.some((record) => record.stepId === input.stepId && record.attempt === input.attempt)) return false;
        runs.set(runId, {
          ...run,
          records: run.records.map((record) =>
            record.stepId === input.stepId && record.attempt === input.attempt
              ? {
                  ...record,
                  status: input.status,
                  output: input.output === undefined ? record.output : input.output,
                  next: input.next === undefined ? record.next : input.next,
                  reason: input.reason === undefined ? record.reason : input.reason,
                }
              : record,
          ),
        });
        return true;
      }),
    amend: (runId, input) =>
      attempt('amend', () => {
        const run = runs.get(runId);
        if (!run) return 'stale';
        if (run.plan.revision !== input.fromRevision) return 'stale';
        if (amendmentProblems(run, input.plan).length > 0) return 'stale';
        runs.set(runId, { ...run, plan: input.plan });
        return 'amended';
      }),
    finish: (runId, input, lease) =>
      attempt('finish', () => {
        const run = runs.get(runId);
        if (!run || !holds(run, lease)) return false;
        runs.set(runId, { ...run, status: input.status, reason: input.reason ?? null });
        return true;
      }),
  };
}

function holds(run: WorkflowRun, lease: WorkflowLease): boolean {
  return run.lease !== null && run.lease.token === lease.token;
}

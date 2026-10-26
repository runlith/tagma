import { Cause, Clock, Context, Effect, Exit, Layer } from 'effect';
import type { ThreadRow } from '../thread/rows';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import { ThreadOwner, ThreadStore, ThreadWorkflowMembers } from '../thread/ThreadPorts';
import { workflowPackMemberId, type WorkflowBinding, type WorkflowCount, type WorkflowInput, type WorkflowStep } from './definition';
import { WorkflowUnknownError } from './library';
import type { WorkflowPlan } from './plan';
import {
  WorkflowArgumentsError,
  workflowArgumentsRefused,
  workflowNext,
  type WorkflowLease,
  type WorkflowNext,
  type WorkflowRun,
} from './run';
import { DeclaredWorkflow, type WorkflowConfig } from './WorkflowConfig';
import { workflowTask } from './WorkflowVoice';

type StepOutcome = {
  readonly status: 'done' | 'failed' | 'exhausted';
  readonly output?: Record<string, unknown>;
  readonly reason?: string;
};

export class WorkflowEngine extends Context.Service<
  WorkflowEngine,
  {
    start(input: {
      readonly id: string;
      readonly workflow: string;
      readonly plan: WorkflowPlan;
      readonly thread: string;
      readonly input: Record<string, unknown>;
    }): Effect.Effect<WorkflowRun | WorkflowArgumentsError, ThreadBorderFailed>;
    advance(runId: string): Effect.Effect<WorkflowRun | undefined, ThreadBorderFailed>;
  }
>()('@runlith/agent/WorkflowEngine') {}

export const workflowEngineLayer: Layer.Layer<WorkflowEngine, never, DeclaredWorkflow | ThreadOwner | ThreadStore | ThreadWorkflowMembers> =
  Layer.effect(
    WorkflowEngine,
    Effect.gen(function* () {
      const owner = (yield* ThreadOwner).id;
      const declared = yield* DeclaredWorkflow;
      const stepMembers = yield* ThreadWorkflowMembers;
      const store = yield* ThreadStore;

      const broke = (reason: string) => new ThreadCallBroke({ cause: new Error(reason) });

      const hosted = <A>(work: (host: WorkflowConfig) => Effect.Effect<A, ThreadBorderFailed>): Effect.Effect<A, ThreadBorderFailed> =>
        declared ? work(declared) : Effect.fail(broke('This host declared no workflow, so it drives no run.'));

      const openRun = (
        host: WorkflowConfig,
        input: { id: string; workflow: string; plan: WorkflowPlan; thread: string; input: Record<string, unknown> },
      ): Effect.Effect<WorkflowRun | WorkflowArgumentsError, ThreadBorderFailed> => {
        const refused = workflowArgumentsRefused(input.plan, input.input);
        return refused === null ? host.runs.start(input) : Effect.succeed(refused);
      };

      const answeredBy = (run: WorkflowRun, stepId: string): Record<string, unknown> => {
        for (let index = run.records.length - 1; index >= 0; index -= 1) {
          const record = run.records[index];
          if (record?.stepId === stepId && record.status === 'done') return record.output ?? {};
        }
        return {};
      };

      const listFor = (run: WorkflowRun, count: Exclude<WorkflowCount, number>): readonly unknown[] | string => {
        const held = count.from === 'run' ? run.input[count.field] : answeredBy(run, count.stepId)[count.field];
        const named = count.from === 'run' ? count.field : `${count.stepId}.${count.field}`;
        if (held === undefined) return `${named} answered nothing to fan over`;
        if (!Array.isArray(held)) return `${named} answered ${typeof held}, and a fan is counted from a list`;
        return held;
      };

      const bound = (
        run: WorkflowRun,
        binding: WorkflowBinding,
        member: { readonly index: number; readonly item: unknown } | null,
      ): unknown => {
        if (binding.from === 'run') return run.input[binding.field];
        if (binding.from === 'step') return answeredBy(run, binding.stepId)[binding.field];
        if (binding.from === 'index') return member?.index;
        return member?.item;
      };

      const boundInput = (
        run: WorkflowRun,
        input: WorkflowInput | undefined,
        member: { readonly index: number; readonly item: unknown } | null,
      ): Record<string, unknown> =>
        Object.fromEntries(Object.entries(input ?? {}).map(([name, binding]) => [name, bound(run, binding, member)]));

      const threadOf = (run: WorkflowRun) =>
        Effect.flatMap(store.find(run.thread), (thread) =>
          thread ? Effect.succeed(thread) : Effect.fail(broke(`Workflow run ${run.id} has no thread ${run.thread}.`)),
        );

      const reportsOf = (
        thread: ThreadRow,
        members: readonly string[],
        deadlineMs: number,
      ): Effect.Effect<ReadonlyMap<string, string>, ThreadBorderFailed> => stepMembers.waitForReports({ thread, members, deadlineMs });

      const chooseNext = Effect.fnUntraced(function* (
        host: WorkflowConfig,
        run: WorkflowRun,
        stepId: string,
        output: Record<string, unknown>,
      ): Effect.fn.Return<{ to: string | null } | { unheld: string }, ThreadBorderFailed> {
        for (const transition of run.plan.transitions) {
          if (transition.from !== stepId) continue;
          if (transition.when === undefined) return { to: transition.to };
          const condition = host.conditions[transition.when];
          if (!condition) return { unheld: `This host holds no condition named ${transition.when}.` };
          const held = yield* condition({ condition: transition.when, run, step: { stepId, output } });
          if (held) return { to: transition.to };
        }
        return { to: null };
      });

      const workedBy = Effect.fnUntraced(function* (
        host: WorkflowConfig,
        run: WorkflowRun,
        step: Extract<WorkflowStep, { kind: 'agent' | 'pack' }>,
        attempt: number,
        names: readonly string[],
        list: readonly unknown[] | null,
        thread: ThreadRow,
      ): Effect.fn.Return<StepOutcome, ThreadBorderFailed> {
        const held = run.records.findIndex((record) => record.stepId === step.id && record.attempt === attempt);
        const bornOf = { by: run.id, step: held === -1 ? run.records.length : held };
        const members = yield* Effect.forEach(names, (name, index) =>
          Effect.map(
            stepMembers.startMember({
              parent: thread,
              requestId: `${run.id}:${step.id}:${attempt}:${name}`,
              bornOf,
              agentId: step.agentType,
              task: workflowTask(step.task, boundInput(run, step.input, list === null ? null : { index, item: list[index] })),
              name,
            }),
            (started) => started.threadId,
          ),
        );
        const answered = yield* reportsOf(thread, members, host.stepDeadlineMs);
        const enough =
          step.kind === 'pack' && step.completion.rule === 'at-least'
            ? answered.size >= step.completion.atLeast
            : answered.size === members.length;
        const reports = members.flatMap((member) => {
          const text = answered.get(member);
          return text === undefined ? [] : [text];
        });
        if (enough) return { status: 'done', output: { reports } } satisfies StepOutcome;
        return {
          status: 'exhausted',
          output: { reports },
          reason: `${answered.size} of ${members.length} agents reported before the deadline`,
        } satisfies StepOutcome;
      });

      const runStep = Effect.fnUntraced(function* (
        host: WorkflowConfig,
        run: WorkflowRun,
        step: WorkflowStep,
        next: Extract<WorkflowNext, { kind: 'resume' | 'start' }>,
        lease: WorkflowLease,
      ): Effect.fn.Return<boolean, ThreadBorderFailed> {
        const attempt = next.kind === 'resume' ? next.record.attempt : next.attempt;
        const claim = (record: { members: readonly string[]; callRunId?: string }) =>
          next.kind === 'resume'
            ? Effect.succeed(true)
            : host.runs.dispatch(run.id, { stepId: step.id, attempt, status: 'dispatched', ...record }, lease);
        const settle = Effect.fnUntraced(function* (outcome: StepOutcome) {
          const chosen = outcome.status === 'done' ? yield* chooseNext(host, run, step.id, outcome.output ?? {}) : { to: undefined };
          const ended: StepOutcome = 'unheld' in chosen ? { status: 'failed', reason: chosen.unheld } : outcome;
          return yield* host.runs.settleStep(
            run.id,
            {
              stepId: step.id,
              attempt,
              status: ended.status,
              output: ended.output,
              reason: ended.reason,
              next: 'to' in chosen && chosen.to !== undefined ? chosen.to : undefined,
            },
            lease,
          );
        });

        if (step.kind === 'transform') {
          if (!(yield* claim({ members: [] }))) return false;
          const seam = host.seams[step.seam];
          if (!seam) {
            return yield* settle({ status: 'failed', reason: `This host holds no seam named ${step.seam}.` });
          }
          const folded = yield* seam({
            seam: step.seam,
            run,
            from: (step.from ?? []).map((source) => ({ stepId: source, output: answeredBy(run, source) })),
          });
          const absent = Object.keys(step.output).filter((field) => !(field in folded));
          return yield* settle(
            absent.length > 0
              ? { status: 'failed', reason: `${step.seam} answered nothing under ${absent.join(', ')}` }
              : { status: 'done', output: folded },
          );
        }

        if (step.kind === 'call') {
          const child = `${run.id}:${step.id}:${attempt}`;
          if (!(yield* claim({ members: [], callRunId: child }))) return false;
          const resolved = (yield* host.library(run)).resolve(step.workflow);
          if (resolved instanceof WorkflowUnknownError) {
            return yield* settle({ status: 'failed', reason: resolved.message });
          }
          const standing = yield* host.runs.find(child);
          if (!standing) {
            const opened = yield* openRun(host, {
              id: child,
              workflow: step.workflow,
              plan: resolved.plan,
              thread: run.thread,
              input: boundInput(run, step.input, null),
            });
            if (opened instanceof WorkflowArgumentsError) return yield* settle({ status: 'failed', reason: opened.message });
          }
          const ended = yield* drive(host, child);
          if (ended?.status !== 'completed') {
            return yield* settle({
              status: 'failed',
              reason: ended?.reason ? ended.reason : undefined,
            });
          }
          return yield* settle({ status: 'done', output: ended.records[ended.records.length - 1]?.output ?? {} });
        }

        const thread = yield* threadOf(run);
        const fan = step.kind === 'pack' && typeof step.count !== 'number' ? listFor(run, step.count) : null;
        if (typeof fan === 'string') {
          if (!(yield* claim({ members: [] }))) return false;
          return yield* settle({ status: 'failed', reason: fan });
        }
        const names =
          next.kind === 'resume'
            ? next.record.members
            : step.kind === 'pack'
              ? Array.from({ length: packWidth(step.count, fan) }, (_, index) => workflowPackMemberId(step.id, index))
              : [step.id];
        if (!(yield* claim({ members: names }))) return false;
        if (step.kind === 'pack' && step.completion.rule === 'at-least' && step.completion.atLeast > names.length) {
          return yield* settle({
            status: 'failed',
            reason: `${step.id} waits for ${step.completion.atLeast} of ${names.length} members, which never happens`,
          });
        }
        return yield* settle(yield* workedBy(host, run, step, attempt, names, fan, thread));
      });

      const renewing = Effect.fnUntraced(function* (host: WorkflowConfig, runId: string, lease: WorkflowLease) {
        const period = Math.max(1, Math.floor(host.leaseMs / 2));
        for (;;) {
          yield* Effect.sleep(period);
          if (!(yield* host.runs.renew(runId, lease, { until: (yield* Clock.currentTimeMillis) + host.leaseMs }))) return;
        }
      });

      const walk = Effect.fnUntraced(function* (
        host: WorkflowConfig,
        runId: string,
        lease: WorkflowLease,
      ): Effect.fn.Return<WorkflowRun | undefined, ThreadBorderFailed> {
        for (;;) {
          const run = yield* host.runs.find(runId);
          if (!run || run.status !== 'running') return run;
          const next = workflowNext(run);
          if (next.kind === 'completed') {
            yield* host.runs.finish(runId, { status: 'completed' }, lease);
            return yield* host.runs.find(runId);
          }
          if (next.kind === 'failed') {
            yield* host.runs.finish(
              runId,
              {
                status: 'failed',
                reason: next.record.reason ?? `${next.record.stepId} ended ${next.record.status}`,
              },
              lease,
            );
            return yield* host.runs.find(runId);
          }
          const stepId = next.kind === 'resume' ? next.record.stepId : next.stepId;
          const step = run.plan.steps.find((candidate) => candidate.id === stepId);
          if (!step) return yield* Effect.fail(broke(`Workflow run ${runId} has no step ${stepId} in its plan.`));
          if (!(yield* runStep(host, run, step, next, lease))) return yield* host.runs.find(runId);
        }
      });

      const drive = Effect.fnUntraced(function* (
        host: WorkflowConfig,
        runId: string,
      ): Effect.fn.Return<WorkflowRun | undefined, ThreadBorderFailed> {
        const now = yield* Clock.currentTimeMillis;
        const lease = yield* host.runs.lease(runId, { owner, until: now + host.leaseMs, now });
        if (!lease) return yield* host.runs.find(runId);
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.forkScoped(renewing(host, runId, lease));
            return yield* walk(host, runId, lease);
          }),
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)
              ? Effect.gen(function* () {
                  const reason = Cause.pretty(exit.cause);
                  const run = yield* host.runs.find(runId);
                  const step = run?.records.at(-1);
                  if (step?.status === 'dispatched') {
                    yield* host.runs.settleStep(runId, { stepId: step.stepId, attempt: step.attempt, status: 'failed', reason }, lease);
                  }
                  yield* host.runs.finish(runId, { status: 'failed', reason }, lease);
                })
              : Effect.void,
          ),
        );
      });

      return {
        start: (input) => hosted((host) => openRun(host, input)),
        advance: (runId) => hosted((host) => drive(host, runId)),
      };
    }),
  );

function packWidth(count: WorkflowCount, list: readonly unknown[] | null): number {
  if (typeof count === 'number') return count;
  return Math.min(count.limit, list?.length ?? 0);
}

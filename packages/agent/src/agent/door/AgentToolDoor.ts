import { activity, type ActivityEnding, defected } from '@runlith/activity/Activity';
import { Cause, Clock, Effect, Exit } from 'effect';
import type { PermissionOutcome } from '../../permissions/vocabulary';
import { TOOL_CALL, TOOL_PREFLIGHT } from '../activities';
import { AgentToolFailed, type AgentRuleFailed, type AgentToolFailure } from '../AgentFailure';
import type { AgentRunState } from '../AgentRunState';
import type { AgentScopeAdmission } from '../AgentScope';
import type { AgentDirective, AgentEvaluationFacts } from '../policy/AgentRuntimePolicy';
import type { ToolCaller } from '../contracts';
import { agentSpan } from '../spans';
import { type Claim, ToolFailed, type ToolVerdict, toolClaims } from '../tool';
import { argumentsBody, modelOutputBody } from '../ToolOutput';
import type { CallLedger } from './CallLedger';
import { type CallOrder, CallStoppedInQueue, queuedReason } from './CallOrder';
import { DoorMisuse, failedEnding } from './failures';
import type { OutputProjection } from './OutputProjection';
import type { ToolAdmission } from './ToolAdmission';
import type { ToolExecution } from './ToolExecution';
import type { ToolRules } from './ToolRules';
import type { ToolRun } from './ToolRun';
import type {
  AgentCallAdoption,
  AgentPermissionQuestion,
  AgentToolAttended,
  AgentToolInvocation,
  AgentToolOutcome,
  AgentToolPreflight,
  AgentToolProduced,
} from './types';

export type AgentToolDoor<TCtx = unknown> = ReturnType<typeof makeAgentToolDoor<TCtx>>;

const toolEnding = (verdict: ToolVerdict): ActivityEnding<object> => {
  switch (verdict.kind) {
    case 'answered':
      return { outcome: 'ok' };
    case 'refused':
      return { outcome: 'refused', reason: verdict.refusal.code, message: verdict.refusal.reason };
    case 'failed':
      return { outcome: 'failed', message: verdict.error };
    case 'denied':
      return { outcome: 'refused' };
    case 'cancelled':
      return { outcome: 'cancelled' };
    case 'unknown':
      return { outcome: 'failed', reason: 'unknown' };
  }
};

export const makeAgentToolDoor = <TCtx>({
  run,
  ledger,
  order,
  admission,
  execution,
  outputs,
  rules,
}: {
  readonly run: ToolRun<TCtx>;
  readonly ledger: CallLedger;
  readonly order: CallOrder;
  readonly admission: ToolAdmission<TCtx>;
  readonly execution: ToolExecution<TCtx>;
  readonly outputs: OutputProjection;
  readonly rules: ToolRules<TCtx>;
}) => {
  const answering = <A>(
    name: string,
    toolCallId: string,
    settling: () => Effect.Effect<A, AgentToolFailure>,
  ): Effect.Effect<A, AgentToolFailure> =>
    Effect.suspend(settling).pipe(
      Effect.catchDefect((defect) => {
        if (defect instanceof DoorMisuse) return Effect.die(defect);
        const prepared = ledger.preparedOf(toolCallId);
        return Effect.andThen(defected(Cause.die(defect), `tool ${name}`), Clock.currentTimeMillis).pipe(
          Effect.flatMap((at) =>
            Effect.fail(
              new AgentToolFailed({
                toolName: name,
                toolCallId,
                cause: defect,
                durationMs: prepared === undefined ? undefined : at - prepared.openedAt,
              }),
            ),
          ),
        );
      }),
    );

  const called = <E>(
    toolName: string,
    toolCallId: string,
    executedBy: 'host' | 'provider',
    source: string | undefined,
    work: Effect.Effect<AgentToolOutcome, E>,
  ): Effect.Effect<AgentToolOutcome, E> =>
    execution
      .costing(
        toolCallId,
        toolName,
        activity(TOOL_CALL, { toolName, toolCallId, executedBy }, work, {
          ...run.attribution(),
          bodies: source === undefined ? [] : [argumentsBody(source)],
          ended: (exit) =>
            Exit.isSuccess(exit)
              ? {
                  ...toolEnding(exit.value.verdict),
                  bodies: [modelOutputBody(exit.value.modelOutput)],
                }
              : failedEnding(exit),
        }),
      )
      .pipe(Effect.ensuring(Effect.sync(() => execution.finishCost(toolCallId))));

  const questionOf = (call: AgentToolInvocation): AgentPermissionQuestion => ({
    name: call.name,
    tool: call.tool,
    input: call.input,
    toolCallId: call.options.toolCallId,
    resultRetention: call.resultRetention,
  });

  const receipted = (call: AgentToolInvocation, outcome: AgentToolOutcome): Effect.Effect<AgentToolOutcome> =>
    agentSpan({ type: 'tool-call', runId: run.runId, toolName: call.name, toolCallId: call.options.toolCallId, executedBy: 'host' })(
      called(call.name, call.options.toolCallId, 'host', call.arguments, Effect.succeed(outcome)),
    );

  const claims = (call: AgentPermissionQuestion): Effect.Effect<readonly Claim[], AgentToolFailed | AgentRuleFailed> =>
    execution.costing(
      call.toolCallId,
      call.name,
      Effect.flatMap(admission.judge(call), ({ input, denied }) =>
        denied !== null
          ? Effect.succeed([])
          : toolClaims(call.tool, input, { toolCallId: call.toolCallId, caller: run.caller }).pipe(
              Effect.mapError((cause) => new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause })),
            ),
      ),
    );

  const turn = (call: AgentPermissionQuestion, queued: (standing: boolean) => void): Effect.Effect<void, AgentToolFailed> =>
    order
      .turn(call.toolCallId, call.name, (after) => {
        queued(true);
        execution.queued(call.toolCallId, queuedReason(after));
      })
      .pipe(
        Effect.tap(() => Effect.sync(() => queued(false))),
        Effect.catchTag('CallBlockedByReader', (blocked) =>
          Effect.fail(
            new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause: new ToolFailed({ reason: blocked.message }) }),
          ),
        ),
      );

  const preflight = (call: AgentPermissionQuestion): Effect.Effect<AgentToolPreflight, AgentToolFailure> =>
    execution.costing(
      call.toolCallId,
      call.name,
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          const held = ledger.replayPreflight(call);
          if (held) return restore(held);
          const closed = ledger.opened(call.toolCallId);
          if (closed) return closed;
          const reading = activity(
            TOOL_PREFLIGHT,
            { toolName: call.name, toolCallId: call.toolCallId },
            answering(call.name, call.toolCallId, () => admission.inspect(call)),
            {
              ...run.attribution(),
              ended: (exit) => (Exit.isSuccess(exit) ? { result: verdictOf(exit.value.permission) } : failedEnding(exit)),
            },
          );
          let queued = false;
          const preparing = execution.preparing(
            call,
            Effect.andThen(
              turn(call, (standing) => {
                queued = standing;
              }),
              reading,
            ),
            (reason) =>
              new AgentToolFailed({
                toolName: call.name,
                toolCallId: call.toolCallId,
                cause: queued ? new CallStoppedInQueue({ reason }) : new ToolFailed({ reason }),
              }),
          );
          return ledger.preflighting(
            call,
            restore(preparing).pipe(
              Effect.tap((prepared) => Effect.sync(() => execution.prepared(call, prepared))),
              Effect.tapError(() => Effect.sync(() => order.release(call.toolCallId))),
            ),
          );
        }),
      ),
    );

  return {
    get runState(): AgentRunState {
      return run.runState;
    },

    get caller(): ToolCaller {
      return run.caller;
    },

    get unattended(): boolean {
      return run.unattended;
    },

    close: ledger.close,

    admit(next: AgentScopeAdmission<TCtx>): void {
      ledger.advance(next.generation);
      run.ctx = next.ctx;
    },

    evaluate(facts: AgentEvaluationFacts, ctx?: TCtx): Effect.Effect<readonly AgentDirective[], AgentRuleFailed> {
      return rules.evaluate(facts, ctx);
    },

    claims,

    order,

    preflight,

    verdict: (call: AgentPermissionQuestion): Effect.Effect<PermissionOutcome, AgentToolFailure> =>
      Effect.map(preflight(call), (prepared) => prepared.permission),

    preflighted: ledger.preflighted,

    approved: (call: AgentPermissionQuestion): Effect.Effect<AgentToolPreflight, AgentToolFailure> =>
      Effect.suspend(() =>
        ledger.resolvable(call.tool, call.toolCallId, call.name, call.input)
          ? preflight(call)
          : Effect.fail(admission.lostResolution(call.name, call.toolCallId)),
      ),

    resolutionsOf: ledger.resolutionsOf,

    attend: (call: AgentToolInvocation): Effect.Effect<AgentToolAttended, AgentToolFailure> =>
      execution.costing(
        call.options.toolCallId,
        call.name,
        Effect.suspend(() => {
          const toolCallId = call.options.toolCallId;
          const answered = (outcome: AgentToolOutcome): AgentToolAttended => ({ kind: 'answered', outcome });
          const held = ledger.held(toolCallId, call.name, call.input);
          if (held) return Effect.map(held, answered);
          return answering(call.name, toolCallId, () => execution.attend(call, preflight(questionOf(call)))).pipe(
            Effect.flatMap((attended) =>
              attended.kind === 'prepared'
                ? Effect.succeed(attended)
                : Effect.map(
                    ledger.once(toolCallId, call.name, call.input, () => receipted(call, attended.outcome)),
                    answered,
                  ),
            ),
          );
        }),
      ),

    parked: execution.parked,

    adopt: (call: AgentToolInvocation, prepared: AgentToolPreflight): Effect.Effect<AgentCallAdoption, AgentToolFailed | AgentRuleFailed> =>
      execution.costing(
        call.options.toolCallId,
        call.name,
        Effect.flatMap(claims(questionOf(call)), (held) => execution.adopt(call, prepared, held)),
      ),

    keep: (call: AgentToolInvocation): Effect.Effect<AgentToolOutcome | null, AgentToolFailure> =>
      execution.costing(
        call.options.toolCallId,
        call.name,
        Effect.flatMap(execution.keep(call.options.toolCallId), (receipt) =>
          receipt === null
            ? Effect.succeed(null)
            : ledger.once(call.options.toolCallId, call.name, call.input, () => receipted(call, receipt)),
        ),
      ),

    settle: (call: AgentToolInvocation, prepared?: AgentToolPreflight): Effect.Effect<AgentToolOutcome, AgentToolFailure> => {
      const toolCallId = call.options.toolCallId;
      return execution
        .costing(
          toolCallId,
          call.name,
          ledger.once(toolCallId, call.name, call.input, () =>
            answering(call.name, toolCallId, () => {
              if (prepared === undefined && call.confirmed === true && !ledger.resolvable(call.tool, toolCallId, call.name, call.input)) {
                return Effect.fail(admission.lostResolution(call.name, toolCallId));
              }
              const entered: Effect.Effect<AgentToolAttended, AgentToolFailure> = prepared
                ? Effect.map(admission.accepted(call, prepared), (ready) => ({ kind: 'prepared', prepared: ready }))
                : execution.attend(call, preflight(questionOf(call)));
              return Effect.flatMap(entered, (attended) => {
                if (attended.kind === 'answered') return receipted(call, attended.outcome);
                const ready = attended.prepared;
                return agentSpan({ type: 'tool-call', runId: run.runId, toolName: call.name, toolCallId, executedBy: 'host' })(
                  called(
                    call.name,
                    toolCallId,
                    'host',
                    call.arguments,
                    execution.perform(call, ready).pipe(
                      Effect.catchTag('AgentToolFailed', (failure) =>
                        Clock.currentTimeMillis.pipe(
                          Effect.flatMap((at) =>
                            Effect.fail(
                              new AgentToolFailed({
                                toolName: failure.toolName,
                                toolCallId: failure.toolCallId,
                                cause: failure.cause,
                                projection: failure.projection,
                                durationMs: at - ready.openedAt,
                              }),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              });
            }),
          ),
        )
        .pipe(Effect.onExit(() => Effect.sync(() => execution.ended(toolCallId))));
    },

    settled: (call: AgentToolProduced): Effect.Effect<AgentToolOutcome, AgentToolFailure> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          const held = ledger.held(call.toolCallId, call.name, call.input);
          if (held) return restore(held);
          return ledger.hold(
            restore(
              agentSpan({
                type: 'tool-call',
                runId: run.runId,
                toolName: call.name,
                toolCallId: call.toolCallId,
                executedBy: 'provider',
              })(
                answering(call.name, call.toolCallId, () =>
                  Effect.flatMap(
                    admission.decode({ name: call.name, tool: call.tool, input: call.input, toolCallId: call.toolCallId }),
                    (input) =>
                      called(
                        call.name,
                        call.toolCallId,
                        'provider',
                        call.arguments,
                        outputs.project({ ...call, input }, true).pipe(
                          Effect.map((projection): AgentToolOutcome => ({
                            ...projection,
                            executed: true,
                            verdict: { kind: 'answered' },
                            display: outputs.display({
                              tool: call.tool,
                              published: undefined,
                              answered: undefined,
                              modelOutput: projection.modelOutput,
                            }),
                          })),
                        ),
                      ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),

    receipt: ledger.receipt,
    callStops: execution.callStops,
    decline: execution.decline,
  };
};

const verdictOf = (permission: PermissionOutcome) =>
  permission.verdict === 'deny'
    ? { verdict: permission.verdict, rule: permission.code }
    : permission.verdict === 'ask' && permission.reasons[0] !== undefined
      ? { verdict: permission.verdict, rule: permission.reasons[0].id }
      : { verdict: permission.verdict };

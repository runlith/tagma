import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { nativeThreadIdOf } from '../platform/contract/wire/actor.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import type { HarnessFailure } from '../threads/contract/service/failure.js';
import { declaredRefusals } from '../threads/refusalAnswers.js';
import { HarnessAdoption } from './contract/service/adoption.js';
import { HarnessGuidance } from './contract/service/guidance.js';
import { HarnessPermissions } from './contract/service/permissions.js';
import { HarnessReports } from './contract/service/reports.js';
import { HOOK_OPERATIONS } from './contract/wire/hooks.js';

const OUTCOME_WAIT_MS = 10_000;

const provenThread = (caller: Caller) => {
  const thread = nativeThreadIdOf(caller.actor);
  return thread !== null
    ? Effect.succeed(thread)
    : Effect.fail(
        new GateRefusal('session-unproven', 'a harness reports onto the thread this call proves it is, and this call proves none', [
          "run it from that thread's own process, which carries the grant this door proves",
        ]),
      );
};

export const hookReported = pair(
  HOOK_OPERATIONS.report_harness_event,
  body(HOOK_OPERATIONS.report_harness_event, {
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const receipt = yield* declaredRefusals(HOOK_OPERATIONS.report_harness_event)((yield* HarnessReports).reported(threadId, input));
      return { status: 'reported' as const, ...receipt };
    }),
  }),
);

export const hookJudged = pair(
  HOOK_OPERATIONS.judge_harness_call,
  body(HOOK_OPERATIONS.judge_harness_call, {
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const decision = yield* declaredRefusals(HOOK_OPERATIONS.judge_harness_call)((yield* HarnessPermissions).judge(threadId, input));
      return { status: 'judged' as const, decision };
    }),
  }),
);

export const hookOutcome = pair(
  HOOK_OPERATIONS.record_harness_outcome,
  body(HOOK_OPERATIONS.record_harness_outcome, {
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const answer = yield* declaredRefusals(HOOK_OPERATIONS.record_harness_outcome)(
        (yield* HarnessPermissions).outcome(threadId, input.requestId, OUTCOME_WAIT_MS),
      );
      return { status: 'outcome' as const, answer };
    }),
  }),
);

export const hookGuided = pair(
  HOOK_OPERATIONS.guide_harness,
  body(HOOK_OPERATIONS.guide_harness, {
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const guidance = yield* HarnessGuidance;
      const guided = yield* declaredRefusals(HOOK_OPERATIONS.guide_harness)(
        input.kind === 'prompt'
          ? guidance.prompt(threadId, input.evidence, input.inputs)
          : input.kind === 'seed'
            ? guidance.seed(threadId, input.room)
            : guidance.touch(threadId, input.evidence, input.briefs, input.places),
      );
      return { status: 'guided' as const, ...guided };
    }),
  }),
);

export const hookAdopted = pair(
  HOOK_OPERATIONS.adopt_harness_session,
  body(HOOK_OPERATIONS.adopt_harness_session, {
    execute: Effect.fnUntraced(function* (input) {
      const served: number | null = yield* Effect.map(yield* CurrentProject, (call) => call.project.id).pipe(
        Effect.catchIf(
          (refusal) => refusal.code === 'project-required',
          () => Effect.succeed(null),
        ),
      );
      const adopted = yield* declaredRefusals(HOOK_OPERATIONS.adopt_harness_session)((yield* HarnessAdoption).adopt(input, served));
      return { status: 'adopted' as const, ...adopted };
    }),
  }),
);

export const HOOK_PAIRS = [hookReported, hookJudged, hookOutcome, hookGuided, hookAdopted] as const;

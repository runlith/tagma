import { Context, Effect } from 'effect';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { writes } from '../../platform/contract/service/writes.js';
import { Settings } from '../../settings/contract/service/values.js';
import type { NativeThreadSnapshot, NativeThreadState } from '../contract/service/state.js';
import { resolveDelegation } from '../birth/delegation.js';
import { readApproves, type ApprovesReading } from '../approvers.js';
import { gated } from '../projectGate.js';
import type { Delegation } from '../contract/wire/birth.js';
import { ThreadMandate } from '../contract/service/mandate.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ThreadInputRefused, type HarnessFailure } from '../contract/service/failure.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { ThreadTitles } from '../contract/service/titles.js';

export class ThreadAdjustments extends Context.Service<
  ThreadAdjustments,
  {
    setAuthorityMode(threadId: string, projectId: number, mode: AgentApprovalMode): Effect.Effect<NativeThreadSnapshot, HarnessFailure>;
    setTitle(threadId: string, projectId: number, title: string): Effect.Effect<NativeThreadSnapshot, HarnessFailure>;
    setDelegation(threadId: string, projectId: number, delegation: boolean | null): Effect.Effect<Delegation, HarnessFailure>;
    setOperatorNotice(threadId: string, projectId: number, notice: boolean | null): Effect.Effect<boolean | null, HarnessFailure>;
    setApproves(threadId: string, projectId: number, approves: readonly string[] | null): Effect.Effect<ApprovesReading, HarnessFailure>;
    setApprover(threadId: string, projectId: number, approver: 'you' | 'default'): Effect.Effect<'you' | 'default', HarnessFailure>;
  }
>()('tagma/threads/ThreadAdjustments') {}

export const makeThreadAdjustments = Effect.gen(function* () {
  const harness = yield* ThreadHarness;
  const threads = yield* ThreadMandate;
  const records = yield* ThreadRecords;
  const naming = yield* ThreadTitles;
  const rollouts = yield* ThreadRollouts;
  const settings = yield* Settings;
  const units = yield* MachineUnits;
  return ThreadAdjustments.of({
    setAuthorityMode: (threadId, projectId, mode) =>
      gated(records, threadId, projectId, () =>
        harness.threads
          .handle(threadId, OPERATOR_PRINCIPAL)
          .setAuthorityMode(mode)
          .pipe(Effect.tap(() => rollouts.appendMeta(threadId))),
      ),

    setTitle: (threadId, projectId, title) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const trimmed = title.trim();
          if (!trimmed) {
            return yield* Effect.fail(
              new ThreadInputRefused('title-empty', 'A thread title cannot be empty.', [
                'send a title with at least one non-blank character',
              ]),
            );
          }
          yield* units.write(writes('ThreadAdjustments.setTitle', [threadRecord]), (unit) =>
            records.setTitle(unit, threadId, trimmed, 'manual'),
          );
          const snapshot = yield* harness.reads.snapshot(threadId);
          yield* naming.published(threadId);
          return snapshot;
        }),
      ),

    setDelegation: (threadId, projectId, delegation) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          yield* threads.setDelegation(threadId, delegation);
          for (const reached of yield* records.subtree(threadId)) {
            yield* harness.threads
              .publish(reached)
              .pipe(
                Effect.catch((cause) =>
                  Effect.sync(() =>
                    console.warn('[tagma] delegation switched, but a thread state was not published', { threadId: reached, cause }),
                  ),
                ),
              );
          }
          return yield* resolveDelegation(threads, settings, threadId);
        }),
      ),

    setApproves: (threadId, projectId, approves) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          yield* threads.setApproves(threadId, approves);
          for (const reached of yield* records.subtree(threadId)) yield* harness.runs.questions().reroute(reached);
          return yield* readApproves(threads, settings, threadId, projectId);
        }),
      ),

    setApprover: (threadId, projectId, approver) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          yield* threads.setTakenOver(threadId, approver === 'you');
          for (const reached of yield* records.subtree(threadId)) yield* harness.runs.questions().reroute(reached);
          return approver;
        }),
      ),

    setOperatorNotice: (threadId, projectId, notice) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          yield* threads.setOperatorNotice(threadId, notice);
          return notice;
        }),
      ),
  });
});

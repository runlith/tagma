import { Effect } from 'effect';
import type { Raised } from '@runlith/agent/permissions';
import { judge, outcomeRefusal } from '@runlith/agent/modes/ApprovalMode';
import { resolveMode } from '@runlith/agent/modes/ApprovalMode';
import type { Caller } from '../platform/contract/wire/caller.js';
import type { ApprovalAnswer } from '../platform/contract/wire/approval.js';
import { GateRefusal, type Unblock } from '../platform/contract/wire/refusal.js';
import { CallAuthority } from '../platform/contract/service/authority.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { ApprovalRoute, ApprovalSeats, ApprovalWait } from './contract/service/approvalSeats.js';
import { actionKey } from './actionKey.js';

const NO_WAY: Unblock = ['repeat the act once its question is answered'];

const refusalOf = (outcome: Parameters<typeof outcomeRefusal>[0], action: string, unblock: Unblock = NO_WAY): GateRefusal => {
  const refused = outcomeRefusal(outcome, action);
  const ways = refused.unblock ?? [];
  return new GateRefusal(refused.code, refused.reason, ways.length === 0 ? unblock : ([ways[0]!, ...ways.slice(1)] as unknown as Unblock));
};

export const judged = (
  named: string,
  input: unknown,
  prepared: unknown,
  caller: Caller,
): Effect.Effect<void, GateRefusal, OperationCatalog> =>
  caller.actor.kind !== 'thread'
    ? Effect.void
    : Effect.flatMap(OperationCatalog, (catalog) => {
        const actor = caller.actor;
        if (actor.kind !== 'thread') return Effect.void;
        const id = catalog.registry.named(named);
        if (id === null) return Effect.die(new Error(`No operation is registered as ${named}.`));
        const entry = catalog.registry.entry(id);
        return Effect.gen(function* () {
          const raised: readonly Raised[] = entry.raises?.(input, prepared, actor) ?? [];
          const approval = entry.approval;
          const modeId = yield* CallAuthority;
          if (modeId === null) return;
          const modes = catalog.modes;
          const outcome = judge(approval, raised, resolveMode(modes, modeId), modes, {
            toolName: id,
            mutating: entry.mutates === true,
          });
          if (outcome.verdict === 'allow') return;
          if (outcome.verdict === 'deny') {
            return yield* new GateRefusal(outcome.code, `${id} is refused under ${modeId}: ${outcome.reason}`, [
              'the operator switches this thread to another mode',
            ]);
          }
          const seats = yield* ApprovalSeats;
          let answer: ApprovalAnswer = { _tag: 'Unseated' };
          if (seats !== null) {
            const route = yield* yield* ApprovalRoute;
            answer = yield* seats.ask({
              threadId: actor.threadId,
              operation: id,
              key: yield* actionKey({ id, thread: actor.threadId, input, route, raised, subjects: [] }),
              reasons: outcome.reasons,
              route,
              confirmation: entry.confirmation(input, prepared),
              timeoutMs: outcome.timeoutMs,
              waitMs: yield* ApprovalWait,
            });
          }
          if (answer._tag === 'Given') return;
          if (answer._tag === 'Declined') {
            return yield* refusalOf({ kind: 'declined', by: answer.by, note: answer.note }, id);
          }
          if (answer._tag === 'Lapsed') {
            return yield* refusalOf(
              { kind: 'unanswered', questionId: answer.questionId, askedOf: answer.askedOf, timeoutMs: answer.timeoutMs },
              id,
            );
          }
          if (answer._tag === 'Waiting') {
            return yield* refusalOf({ kind: 'approval-pending', questionId: answer.questionId }, id);
          }
          return yield* refusalOf({ kind: 'no-approver' }, id, [
            'the operator performs it: from the window, or with `tagma op` in a shell of their own',
            'the operator switches this thread to a mode that asks about nothing',
          ]);
        });
      });

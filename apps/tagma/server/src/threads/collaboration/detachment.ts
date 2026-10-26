import { and, eq } from 'drizzle-orm';
import { Clock, Context, Effect } from 'effect';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { THREAD_REQUEST_DETACHED } from '@runlith/agent/thread/storage/inbox';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadRecordFacts } from '../../thread-record/contract/wire/record.js';
import { ThreadInputRefused, ThreadWriteConflict, type HarnessFailure } from '../contract/service/failure.js';
import { ThreadList } from '../contract/service/list.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import type { NativeThreadState } from '../contract/service/state.js';
import { gated } from '../projectGate.js';
import { threadInbox } from '../store/tables.js';
import { workflowRun } from '../store/workflow.js';
import { ThreadInbox } from '../store/inbox.js';

export const THREAD_PARENTAGE_SIGNAL = 'thread-parentage';

export type DetachAnswer = { readonly threadId: ThreadId; readonly from: ThreadId; readonly members: number };
export type ReattachAnswer = { readonly threadId: ThreadId; readonly under: ThreadId };

export class ThreadDetachment extends Context.Service<
  ThreadDetachment,
  {
    detach(threadId: string, projectId: number): Effect.Effect<DetachAnswer, HarnessFailure>;
    reattach(threadId: string, projectId: number): Effect.Effect<ReattachAnswer, HarnessFailure>;
  }
>()('tagma/threads/ThreadDetachment') {}

const detaching = writes('ThreadDetachment.detach', [threadRecord, threadInbox]);
const reattaching = writes('ThreadDetachment.reattach', [threadRecord]);

const named = (facts: ThreadRecordFacts | undefined, id: string): string => (facts?.name ? `${facts.name} (${id})` : id);

const notice = {
  detached: (child: string, at: Date) => `${THREAD_PARENTAGE_SIGNAL}:${child}:detached:${at.getTime()}`,
  lost: (parent: string, child: string, at: Date) => `${THREAD_PARENTAGE_SIGNAL}:${parent}:lost:${child}:${at.getTime()}`,
  returned: (child: string, at: Date) => `${THREAD_PARENTAGE_SIGNAL}:${child}:returned:${at.getTime()}`,
  regained: (parent: string, child: string, at: Date) => `${THREAD_PARENTAGE_SIGNAL}:${parent}:regained:${child}:${at.getTime()}`,
};

const refused = (code: string, message: string, unblock: Unblock) => Effect.fail(new ThreadInputRefused(code, message, unblock));

export const makeThreadDetachment = Effect.gen(function* () {
  const harness = yield* ThreadHarness;
  const records = yield* ThreadRecords;
  const inbox = yield* ThreadInbox;
  const list = yield* ThreadList;
  const rollouts = yield* ThreadRollouts;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const moved = (ids: readonly string[]) =>
    Effect.forEach(
      ids,
      (id) =>
        Effect.gen(function* () {
          yield* harness.runs.questions().reroute(id);
          yield* rollouts.appendMeta(id);
          yield* harness.threads.publish(id);
          yield* list.announceThread(id);
        }),
      { discard: true },
    );

  const tell = (facts: ThreadRecordFacts | undefined, id: string, text: string) =>
    facts === undefined
      ? Effect.void
      : Effect.asVoid(
          harness.threads
            .handle(facts.id, OPERATOR_PRINCIPAL)
            .sendSignal({ id, type: THREAD_PARENTAGE_SIGNAL, addressee: 'transport', text }, { ifActive: 'deliver', ifIdle: 'wait' }),
        );

  const takeBack = (facts: ThreadRecordFacts | undefined, id: string) =>
    facts === undefined ? Effect.succeed(false) : harness.threads.handle(facts.id, OPERATOR_PRINCIPAL).retractSignal(id, () => Effect.void);

  const plain = (facts: ThreadRecordFacts) => Effect.map(list.row(facts.id), (row) => row?.plain === true);

  const toldDetached = Effect.fnUntraced(function* (child: ThreadRecordFacts, parentId: string, at: Date) {
    const parent = yield* records.facts(parentId);
    if (!(yield* plain(child))) {
      yield* tell(
        child,
        notice.detached(child.id, at),
        `The operator detached you from ${named(parent, parentId)}: you are a root thread now, and the agents you spawned stay your team. ` +
          `It no longer manages you, the tasks it gave you are closed, and you owe it no answer; your answers go to the operator.`,
      );
    }
    yield* tell(
      parent,
      notice.lost(parentId, child.id, at),
      `The operator detached ${named(child, child.id)} from your team, with everything spawned under it. ` +
        'It no longer reports to you, the tasks you gave it are closed unanswered, and you no longer stop, continue, compact or archive it. ' +
        'Reach it by thread id if you must.',
    );
  });

  const workflowMember = (unit: Unit<'machine'>, facts: ThreadRecordFacts) =>
    facts.bornOf === null
      ? Effect.succeed(false)
      : Effect.map(
          unit.run(
            db
              .select({ id: workflowRun.id })
              .from(workflowRun)
              .where(and(eq(workflowRun.id, facts.bornOf.by), eq(workflowRun.status, 'running')))
              .get(),
          ),
          (row) => row !== undefined,
        );

  return ThreadDetachment.of({
    detach: (threadId, projectId) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const at = new Date(yield* Clock.currentTimeMillis);
          const settled = yield* units.write(detaching, (unit) =>
            Effect.gen(function* () {
              const facts = yield* records.facts(threadId, unit);
              if (facts === undefined) return { status: 'gone' as const };
              if (facts.parentId !== null && (yield* workflowMember(unit, facts))) return { status: 'workflow-member' as const };
              const lifted = yield* records.detach(unit, threadId, at);
              if (lifted.status !== 'detached') return lifted;
              const outside = new Set<string>(lifted.team);
              for (const member of lifted.subtree) {
                const waiting = yield* inbox.pending(member, unit);
                const queued = waiting.flatMap((item) =>
                  item.kind === 'task' && item.state === 'queued' && item.sender.kind === 'thread' && outside.has(item.sender.threadId)
                    ? [item.id]
                    : [],
                );
                yield* inbox.acknowledge(queued, null, unit);
                const open = yield* inbox.openRequests(member, unit);
                yield* inbox.closeRequests(
                  open.flatMap((request) => (request.sender.kind === 'thread' && outside.has(request.sender.threadId) ? [request.id] : [])),
                  THREAD_REQUEST_DETACHED,
                  unit,
                );
              }
              if (lifted.formerRootPinned) yield* records.setPinned(unit, threadId, at);
              if (facts.titleProvenance === 'random' && facts.name !== null) yield* records.setTitle(unit, threadId, facts.name, 'agent');
              return { ...lifted, facts };
            }),
          );
          switch (settled.status) {
            case 'gone':
              return yield* Effect.fail(new ThreadWriteConflict(threadId));
            case 'workflow-member':
              return yield* refused(
                'workflow-member',
                `Thread ${threadId} is a member of a workflow step still running; its plan waits on its report.`,
                ['wait for the workflow step to end, then detach it'],
              );
            case 'not-a-child': {
              if (settled.detachedFrom === null || settled.detachedAt === null) {
                return yield* refused('not-a-child', `Thread ${threadId} is a root: no parent stands above it.`, [
                  'detach a thread that was spawned under another',
                ]);
              }
              const facts = yield* records.facts(threadId);
              if (facts === undefined) return yield* Effect.fail(new ThreadWriteConflict(threadId));
              yield* toldDetached(facts, settled.detachedFrom, settled.detachedAt);
              return { threadId: facts.id, from: settled.detachedFrom, members: (yield* records.subtree(threadId)).length };
            }
            case 'detached':
              yield* moved(settled.subtree);
              yield* toldDetached(settled.facts, settled.from, at);
              return { threadId: settled.facts.id, from: settled.from, members: settled.subtree.length };
          }
        }),
      ),

    reattach: (threadId, projectId) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const answer = yield* units.write(reattaching, (unit) => records.reattach(unit, threadId));
          switch (answer.status) {
            case 'not-detached':
              return yield* refused('not-detached', `Thread ${threadId} was not detached from a parent that still stands.`, [
                'return only a thread detached from a parent that was not deleted',
              ]);
            case 'parent-archived':
              return yield* refused('parent-archived', `Thread ${answer.parent} is archived, so ${threadId} would vanish with it.`, [
                `unarchive ${answer.parent} first`,
              ]);
            case 'name-taken':
              return yield* refused(
                'name-taken',
                `The name ${answer.name} already addresses thread ${answer.holder} in the team ${threadId} would rejoin.`,
                [`rename thread ${answer.holder} first`],
              );
            case 'reattached': {
              yield* moved(answer.subtree);
              const child = yield* records.facts(threadId);
              const parent = yield* records.facts(answer.under);
              if (
                child !== undefined &&
                !(yield* plain(child)) &&
                !(yield* takeBack(child, notice.detached(threadId, answer.detachedAt)))
              ) {
                yield* tell(
                  child,
                  notice.returned(threadId, answer.detachedAt),
                  `The operator returned you under ${named(parent, answer.under)}: it is your parent again.`,
                );
              }
              if (!(yield* takeBack(parent, notice.lost(answer.under, threadId, answer.detachedAt)))) {
                yield* tell(
                  parent,
                  notice.regained(answer.under, threadId, answer.detachedAt),
                  `The operator returned ${named(child, threadId)} to your team, with everything spawned under it.`,
                );
              }
              return { threadId: threadId as ThreadId, under: answer.under };
            }
          }
        }),
      ),
  });
});

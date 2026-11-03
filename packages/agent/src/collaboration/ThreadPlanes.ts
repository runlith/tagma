import { Clock, Context, Effect, Layer } from 'effect';
import type { ToolCaller } from '../agent/contracts';
import type { ThreadBornOf } from '../protocol/birth';
import type { KeyedRequest } from '../thread/keyed';
import { threadTarget, type ThreadRecord } from '../thread/record';
import { ThreadCallBroke, ThreadMissing } from '../thread/ThreadBorder';
import { Approvers } from '../thread/Approvers';
import { ApprovalAnswers } from '../thread/run/ApprovalAnswers';
import type { ThreadPlaneAccess, ThreadPlaneFailure, ThreadSendAnswer, ThreadVerbs } from './ThreadPlaneAccess';
import { type CollaborationConfig, DeclaredCollaboration } from './CollaborationConfig';
import { planeRefused } from './planeRefusal';
import { ContextCompaction } from './compaction';
import { ownLineage, resolveThread } from './reach';
import { ThreadDirectory } from './ThreadDirectory';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import { ThreadSpawnAccess } from './ThreadSpawnAccess';
import { ThreadSpawnTree } from './ThreadSpawnTree';
import { Threads } from './threads';
import { makeTreeActs, type TreeActs } from './treeActs';
import { coldReason } from './wakeCost';
import { makeWakes } from './wakes';
import { ThreadTypes } from './types';

export class ThreadPlanes extends Context.Service<
  ThreadPlanes,
  {
    access(thread: ThreadRecord, runId?: string): Effect.Effect<ThreadPlaneAccess | null, ThreadPlaneFailure>;
    verbs(thread: ThreadRecord): ThreadVerbs | null;
  }
>()('@runlith/agent/ThreadPlanes') {}

const ACT_MS = 60_000;

const COLD_COMPACTION: readonly [string, ...string[]] = [
  'spawn a fresh agent briefed with its last report',
  'compact it again with `wake: true` when that history is worth the full price',
];

export const threadPlanesLayer = Layer.effect(
  ThreadPlanes,
  Effect.gen(function* () {
    const compaction = yield* ContextCompaction;
    const declared = yield* DeclaredCollaboration;
    const directory = yield* ThreadDirectory;
    const answering = yield* ApprovalAnswers;
    const approvers = yield* Approvers;
    const messaging = yield* ThreadEnvelopes;
    const spawnAccess = yield* ThreadSpawnAccess;
    const tree = yield* ThreadSpawnTree;
    const threads = yield* Threads;
    const types = yield* ThreadTypes;
    const request = (key: string): Effect.Effect<KeyedRequest> =>
      Effect.map(Clock.currentTimeMillis, (now) => ({ key, deadline: new Date(now + ACT_MS) }));
    const acts = declared === null ? null : yield* makeTreeActs({ catalog: declared.models, request });
    const wakes = yield* makeWakes;

    const verbsOf = (
      collaboration: CollaborationConfig,
      acting: TreeActs,
      thread: ThreadRecord,
      runId: string | undefined,
    ): ThreadVerbs => {
      const sender = { id: thread.id, principal: thread.principal };
      const envelopes = () => messaging.access(sender, runId);
      return {
        worktreeAsking: collaboration.placement === undefined ? Effect.succeed(null) : collaboration.placement.asking(thread),
        spawnLimits: (root) => tree.limits(thread, true, root),
        spawnHome: (project) =>
          collaboration.placement === undefined
            ? Effect.fail(planeRefused('home-unplaced', 'this host places no child in another project.'))
            : collaboration.placement.home(thread, project),
        crossing: ({ to, within }) => acting.crossing(thread, to, within),
        spawn: ({ step, ...input }) => {
          const bornOf = issuedBy(runId, step);
          return tree.spawn({
            ...input,
            parent: thread,
            runId: runId,
            bornOf: bornOf ?? undefined,
            delegation: true,
          });
        },
        approvals: {
          answer: Effect.fnUntraced(function* (input) {
            const target = yield* resolveThread(threads, thread, input.threadId);
            const status =
              answering === null || target === null
                ? ('unknown' as const)
                : yield* answering.answer({ ...input, threadId: target.id, caller: thread.id });
            return { ...(target === null ? { threadId: input.threadId } : threadTarget(target)), status };
          }),
        },
        stop: (ask) => acting.stop(thread, ask),
        continue: (ask) => acting.continue(thread, ask),
        directory: directory.access(sender),
        messaging: {
          recipients: (to) => envelopes().recipients(to),
          settle: ({ compact, ...input }) => envelopes().settle(input, input.intent === 'task' && compact !== undefined),
          lineage: (to) =>
            Effect.flatMap(envelopes().recipients(to), (found) =>
              'addressable' in found ? Effect.succeed([]) : ownLineage(threads, thread, found.recipients),
            ),
          aheadCrossing: (to) =>
            Effect.flatMap(envelopes().recipients(to), (found) => {
              const [target, ...more] = 'addressable' in found ? [] : found.recipients;
              return target === undefined || more.length > 0 ? Effect.succeed([]) : acting.crossing(thread, target.id, 'descendant');
            }),
          send: ({ compact, asked, ...input }) => {
            if (input.intent !== 'task' || compact === undefined) return envelopes().send(input);
            const handing: Effect.Effect<ThreadSendAnswer, ThreadPlaneFailure> = Effect.gen(function* () {
              const access = envelopes();
              const found = yield* access.recipients(input.to);
              if ('addressable' in found) return found;
              const [target, ...more] = found.recipients;
              if (target === undefined || more.length > 0) return { status: 'refused', code: 'compact-to-many' } as const;
              const child = yield* acting.compactable(thread, {
                threadId: target.id,
                key: input.key,
                asked: asked,
              });
              const cold = input.wake === true ? [] : yield* wakes.compacting(thread, child);
              if (cold.length > 0) return { status: 'refused', code: 'cold-wake', cold } as const;
              const handed = yield* access.sendAhead(child, {
                to: input.to,
                text: input.text,
                keep: compact.keep ?? input.text,
                key: input.key,
              });
              return 'envelopeId' in handed ? ({ status: 'sent', deliveries: [handed] } as const) : handed;
            });
            return handing;
          },
        },
      };
    };

    return ThreadPlanes.of({
      verbs: (thread) => (declared && acts ? verbsOf(declared, acts, thread, undefined) : null),
      access: Effect.fnUntraced(function* (thread, runId) {
        if (declared === null || acts === null) return null;
        const acting = acts;
        const granted = yield* approvers.grantOf(thread.id);
        return {
          ownerId: thread.principal,
          spawnDepth: yield* spawnAccess.depth(thread),
          startable: yield* types.offered({ caller: 'agent', under: thread }),
          models: declared.models(runId),
          menu: declared.menu?.(runId),
          team: declared.team === undefined ? undefined : yield* declared.team(thread, runId),
          spawnSlots: declared.spawnSlots,
          summarizerChoice: compaction.choosesSummarizer,
          worktrees: declared.placement === undefined ? null : yield* declared.placement.asking(thread),
          parent: thread.plain ? null : thread.parentThreadId,
          approves: granted.length === 0 ? undefined : granted,
          acting: (caller) =>
            Effect.map(callingThread(threads, caller), ({ thread: calling, runId }) => ({
              ...verbsOf(declared, acting, calling, runId),
              move: (ask) => acting.move(calling, ask),
              compact: Effect.fnUntraced(function* (ask) {
                const cold = ask.wake === true ? [] : yield* wakes.compacting(calling, yield* acting.compactable(calling, ask));
                if (cold.length > 0) return yield* planeRefused('cold-wake', coldReason(cold), COLD_COMPACTION);
                return yield* acting.compact(calling, ask);
              }),
              rewind: (ask) => acting.rewind(calling, ask),
            })),
          spawnSettlement: Effect.fnUntraced(function* (caller, requestId, subscribe) {
            const { thread: calling } = yield* callingThread(threads, caller);
            const provisioned = yield* threads.birthReceipt(calling.id, requestId);
            if (provisioned === null) return { status: 'aborted' } as const;
            const child = yield* threads.find(provisioned.threadId, calling.principal);
            const creator = child === null ? null : (child.parentThreadId ?? child.createdBy);
            if (child === null || creator !== calling.id) return { status: 'aborted' } as const;
            const output = yield* tree.answer(calling, child, { itemId: provisioned.id, task: provisioned.body.text, subscribe });
            return { status: 'completed', output } as const;
          }),
        } satisfies ThreadPlaneAccess;
      }),
    });
  }),
);

function issuedBy(runId: string | undefined, step: number | undefined): ThreadBornOf | null {
  return runId === undefined || step === undefined ? null : { by: runId, step };
}

function callingThread(
  threads: (typeof Threads)['Service'],
  caller: ToolCaller,
): Effect.Effect<{ readonly thread: ThreadRecord; readonly runId: string }, ThreadPlaneFailure> {
  const calling = caller.thread;
  if (calling === null)
    return Effect.fail(new ThreadCallBroke({ cause: new Error('This act is a thread’s own, and this call has none.') }));
  return Effect.flatMap(threads.find(calling.threadId, caller.ownerId), (thread) =>
    thread === null ? Effect.fail(new ThreadMissing({ threadId: calling.threadId })) : Effect.succeed({ thread, runId: calling.runId }),
  );
}

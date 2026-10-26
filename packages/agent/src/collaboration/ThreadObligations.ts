import { Context, Effect } from 'effect';
import { note } from '@runlith/activity/Activity';
import type { CollaborationNote } from './activities';
import type { ThreadReadFailure } from '../thread/record';
import { saidAsOperator } from '../thread/inboxItems';
import { ThreadCallBroke, type ThreadBorderFailed } from '../thread/ThreadBorder';
import { ThreadInbox } from '../thread/ThreadPorts';
import { agentRule, type AgentRule, type AgentRuleRegistry, type AgentRuleContext } from '../agent/policy/AgentRuntimePolicy';
import type { ThreadView } from '../thread/agents/ThreadAgent';
import { coreEntry } from '../transcript/kinds';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import { FINAL_ANSWER_TOOL } from '../transcript/parts';
import { COLLABORATION_SOURCE } from './CollaborationConfig';
import { THREAD_REQUEST_REQUESTER_GONE, type ThreadInboxRequest } from '../thread/storage/inbox';
import { closingReminder } from './CollaborationVoice';
import { Threads } from './threads';
type Inbox = Context.Service.Shape<typeof ThreadInbox>;
const MESSAGING_VERBS: ReadonlySet<string> = new Set(['send_message', 'send_task', 'interrupt_agent']);
export function requesterOf(request: ThreadInboxRequest): string | null {
  return request.sender.kind === 'thread' ? request.sender.threadId : null;
}
export function isObligation(request: ThreadInboxRequest): boolean {
  return request.body.intent === 'task' && request.sender.kind === 'thread';
}
export function isTaken(request: ThreadInboxRequest): boolean {
  return request.deliveredToRunId !== null;
}
export function newestByRequester<T extends ThreadInboxRequest>(requests: readonly T[]): readonly T[] {
  const newest = new Map<string, T>();
  const arrived = [...requests].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  for (const request of arrived) {
    const from = requesterOf(request);
    if (from !== null) newest.set(from, request);
  }
  return [...newest.values()];
}
export function threadFinalEnvelopeId(requestId: string): string {
  return `envelope:final:${requestId}`;
}
export function notedClosed(
  requests: readonly ThreadInboxRequest[],
  closed: readonly string[],
  by: string,
  runId: string | undefined,
): Effect.Effect<void> {
  const ended = new Set(closed);
  return Effect.forEach(
    requests.filter((request) => ended.has(request.id)),
    (request) => {
      const run = runId ?? request.deliveredToRunId;
      return run === null ? Effect.void : note<CollaborationNote>({ type: 'request-closed', request: request.id, by }, { run });
    },
    { discard: true },
  );
}
export const presentRequesters = Effect.fnUntraced(function* (
  inbox: Inbox,
  threads: Context.Service.Shape<typeof Threads>,
  input: {
    readonly principal: string;
    readonly runId: string;
    readonly owed: readonly ThreadInboxRequest[];
    readonly open: readonly ThreadInboxRequest[];
  },
): Effect.fn.Return<readonly ThreadInboxRequest[], ThreadBorderFailed | ThreadReadFailure> {
  const kept: ThreadInboxRequest[] = [];
  for (const request of input.owed) {
    const from = requesterOf(request);
    if (from === null) continue;
    const requester = yield* threads.find(from, input.principal);
    if (requester !== null) {
      kept.push(request);
      continue;
    }
    const orphaned = input.open.filter((candidate) => requesterOf(candidate) === from);
    const closed = yield* inbox.closeRequests(
      orphaned.map((candidate) => candidate.id),
      THREAD_REQUEST_REQUESTER_GONE,
    );
    yield* notedClosed(orphaned, closed, THREAD_REQUEST_REQUESTER_GONE, input.runId);
  }
  return kept;
});
type ClosingInput = {
  readonly threadId: string;
  readonly ownerId: string;
  readonly runId: string;
  readonly changed: readonly string[];
  readonly messaging: boolean;
};

const makeClosingReminder = Effect.gen(function* () {
  const inbox = yield* ThreadInbox;
  const threads = yield* Threads;
  return Effect.fnUntraced(
    function* (input: ClosingInput) {
      if (!input.messaging) return null;
      if (!input.changed.some((name) => !MESSAGING_VERBS.has(name))) return null;
      const open = yield* inbox.openRequests(input.threadId);
      const answeredHere = new Set(
        open.flatMap((request) => {
          const from = requesterOf(request);
          return request.deliveredToRunId === input.runId && from !== null ? [from] : [];
        }),
      );
      const waiting = newestByRequester(
        open.filter((request) => {
          const from = requesterOf(request);
          return isObligation(request) && !saidAsOperator(request) && isTaken(request) && from !== null && !answeredHere.has(from);
        }),
      );
      if (waiting.length === 0) return null;
      const owed = yield* presentRequesters(inbox, threads, { principal: input.ownerId, runId: input.runId, owed: waiting, open });
      if (owed.length === 0) return null;
      const requests = owed.map((request) => request.id);
      yield* note<CollaborationNote>({ type: 'closing-reminder', requests }, { run: input.runId });
      return {
        text: closingReminder(
          owed.map((request) => ({
            threadId: requesterOf(request) ?? request.threadId,
            name: request.sender.kind === 'thread' ? request.sender.name : null,
            arrivedAt: request.occurredAt,
            task: request.body.text,
          })),
        ),
        state: { requests },
      };
    },
    (effect) =>
      effect.pipe(Effect.catchTag('ThreadRecordUnreadable', (unreadable) => Effect.fail(new ThreadCallBroke({ cause: unreadable })))),
  );
});

const CLOSING_RULE = 'closing-reminder';
const remindedIn = (entry: ThreadTranscriptEntry, runId: string): boolean =>
  coreEntry(entry) &&
  entry.type === 'runtime-guidance' &&
  entry.runId === runId &&
  entry.sources.some((source) => source.state?.closing === true);

export const makeCollaborationClosingRule = Effect.gen(function* () {
  const reminder = yield* makeClosingReminder;
  return (thread: ThreadView): AgentRule<unknown> =>
    agentRule<unknown>(
      CLOSING_RULE,
      Effect.fnUntraced(function* (ctx: AgentRuleContext<unknown>) {
        if (ctx.hook !== 'beforeClose') return null;
        const state = ctx.run.ruleState(CLOSING_RULE, () => ({ spent: thread.transcript.some((entry) => remindedIn(entry, ctx.runId)) }));
        if (state.spent) return null;
        const ran = new Set(ctx.steps.flatMap((step) => step.toolResults.map((result) => result.toolName)));
        for (const entry of thread.transcript) {
          if (coreEntry(entry) && entry.type === 'tool' && entry.runId === ctx.runId && entry.toolState === 'output-available')
            ran.add(entry.toolName);
        }
        const changed = [...ran].filter((name) => ctx.catalog[name]?.mutates === true);
        if (changed.length === 0) return null;
        const guide = yield* reminder({
          threadId: thread.id,
          ownerId: thread.ownerId,
          runId: ctx.runId,
          changed,
          messaging: ctx.catalog[FINAL_ANSWER_TOOL] !== undefined,
        });
        if (guide === null) return null;
        state.spent = true;
        return { type: 'guide' as const, ...guide };
      }),
      { owner: COLLABORATION_SOURCE, hook: 'beforeClose', priority: 0, critical: false },
    );
});

export const registerCollaborationRules = Effect.fnUntraced(function* (registry: AgentRuleRegistry<unknown, ThreadView>) {
  const create = yield* makeCollaborationClosingRule;
  yield* registry.hold(COLLABORATION_SOURCE, { id: CLOSING_RULE, create });
});

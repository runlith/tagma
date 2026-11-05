import { Clock, type Context, Effect } from 'effect';
import { type Keyed, type KeyedSpent, type TransitionOutcome } from '../thread/keyed';
import type { ThreadRecord } from '../thread/record';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import type { ThreadInbox } from '../thread/ThreadPorts';
import type { InboxPlan, ThreadInboxItemValues, ThreadInboxSender } from '../thread/storage/inbox';
import type { ThreadEnvelopeInput } from './ThreadEnvelopes';
import type { ThreadPlaneFailure } from './ThreadPlaneAccess';

const ENVELOPE_ACT_MS = 60_000;

export const actDeadline: Effect.Effect<Date> = Effect.map(Clock.currentTimeMillis, (now) => new Date(now + ENVELOPE_ACT_MS));

export type Controlled<A> =
  | { readonly status: 'done'; readonly result: A; readonly acted: boolean }
  | { readonly status: 'refused'; readonly result: A }
  | KeyedSpent;

export const controlled = Effect.fnUntraced(function* <A>(
  inbox: Context.Service.Shape<typeof ThreadInbox>,
  threadId: string,
  plan: InboxPlan<A>,
  key: Keyed,
): Effect.fn.Return<Controlled<A>, ThreadPlaneFailure> {
  const outcome: TransitionOutcome<A> = yield* inbox.control(threadId, plan, { key, deadline: yield* actDeadline });
  if ('committed' in outcome) return { status: 'done', result: outcome.committed, acted: true } as const;
  if ('replayed' in outcome) return { status: 'done', result: outcome.replayed, acted: false } as const;
  if ('refused' in outcome) return { status: 'refused', result: outcome.refused } as const;
  if ('spent' in outcome) return { status: 'spent', at: outcome.spent.at } as const;
  return yield* new ThreadCallBroke({
    cause: new Error(
      outcome.stalled === 'none'
        ? `The inbox act on thread ${threadId} reached its deadline before it committed; nothing was written.`
        : `The inbox act on thread ${threadId} may have committed; retry it under the same key.`,
    ),
  });
});

export function itemOf(
  recipient: ThreadRecord,
  envelope: ThreadEnvelopeInput,
  from: ThreadRecord | null,
  text: string,
): ThreadInboxItemValues {
  const sender: ThreadInboxItemValues['sender'] =
    envelope.senderThreadId === null ? { kind: 'host' } : threadSender(recipient, envelope.senderThreadId, from);
  const shared = { id: envelope.id, threadId: recipient.id, sender, occurredAt: new Date().toISOString() };
  return envelope.intent === 'task' || envelope.intent === 'interrupt'
    ? { ...shared, kind: 'task', body: { intent: envelope.intent, text, inReplyTo: envelope.inReplyTo ?? null } }
    : {
        ...shared,
        kind: 'envelope',
        body: { intent: envelope.intent, text, inReplyTo: envelope.inReplyTo ?? null, context: envelope.context },
      };
}

export function threadSender(recipient: ThreadRecord, threadId: string, from: ThreadRecord | null): ThreadInboxSender {
  const home = from?.projectId === undefined ? {} : { projectId: from.projectId };
  const voice = { kind: 'thread', threadId, name: from?.name ?? threadId, ...home } as const;
  return recipient.plain && recipient.parentThreadId === threadId ? { ...voice, asOperator: true } : voice;
}

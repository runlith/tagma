import { barrierIdAhead } from '../thread/inboxItems';
import { actDigest, callKey, type Evidence, type Keyed } from '../thread/keyed';
import type { ThreadRecord } from '../thread/record';
import type { ThreadInboxItem } from '../thread/storage/inbox';
import type { ThreadEnvelopeInput, ThreadSendAsk } from './ThreadEnvelopes';
import { threadFinalEnvelopeId } from './ThreadObligations';
import type { AgentSignalContext } from '../agent/contracts';

export type FinalAnswered = { readonly requestId: string; readonly closed: readonly string[] };

export function sendEvidence(holderId: string, key: string): Evidence {
  return { call: callKey({ operation: 'send', actor: holderId, key }) };
}

export function finalKey(holderId: string, input: ThreadSendAsk): Keyed {
  return {
    evidence: sendEvidence(holderId, input.key),
    digest: actDigest({ to: input.to, intent: 'message', final: true, text: input.text.trim() }),
  };
}

export function finalEnvelope(holder: ThreadRecord, requestId: string, text: string, context?: AgentSignalContext): ThreadEnvelopeInput {
  return { id: threadFinalEnvelopeId(requestId), senderThreadId: holder.id, intent: 'report', text, inReplyTo: requestId, context };
}

export function sameEnvelope(item: ThreadInboxItem, threadId: string, envelope: ThreadEnvelopeInput, text: string): boolean {
  return (
    item.threadId === threadId &&
    (item.kind === 'task' || item.kind === 'envelope') &&
    item.body.intent === envelope.intent &&
    item.body.text.trim() === text &&
    item.body.inReplyTo === (envelope.inReplyTo ?? null)
  );
}

export function threadReportEnvelopeId(taskId: string, ending: string): string {
  return `envelope:report:${taskId}:${ending}`;
}

type RequestKind = Exclude<ThreadEnvelopeInput['intent'], 'report'> | 'spawn';

export function envelopePrefix(kind: RequestKind, senderThreadId: string): string {
  return `envelope:${kind}:${senderThreadId}:`;
}

export function sentTaskPrefixes(senderThreadId: string): readonly string[] {
  const task = envelopePrefix('task', senderThreadId);
  return [envelopePrefix('spawn', senderThreadId), task, barrierIdAhead({ id: task })];
}

export function threadEnvelopeId(
  intent: Exclude<ThreadEnvelopeInput['intent'], 'report'>,
  senderThreadId: string,
  key: string,
  position: number,
): string {
  return `${envelopePrefix(intent, senderThreadId)}${key}:${position}`;
}

export function threadWithdrawnEnvelopeId(taskId: string): string {
  return `envelope:withdrawn:${taskId}`;
}

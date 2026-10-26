import type { ThreadFailureDiagnostics } from '@runlith/agent/transcript/entries';
import { SAID_LINE_CHARS } from '../contract/wire/list.js';
import type { ThreadNow } from '../contract/wire/operations/subscriptions.js';
import type { SubscribedEvent } from '../events/happened.js';
import { cutText } from '../list/pendingAsk.js';
import type { ThreadSummary } from '../list/summary.js';

type Ending = { readonly status: string; readonly failureReason: string | null; readonly failure: ThreadFailureDiagnostics | null };

const labelOf = (thread: ThreadSummary) => `${thread.name ?? thread.title} (${thread.id})`;

const answered = (words: string | null) => (words === null ? '' : `; its last answer:\n\n${words}`);

const clock = (at: string) => `${at.slice(11, 16)}Z`;

function failureOf(ending: Ending): string {
  const failure = ending.failure;
  const facts = [
    ending.failureReason ?? failure?.detail ?? failure?.type ?? (ending.status === 'cut' ? 'the run was cut' : 'the run failed'),
    failure?.type,
    failure?.provider,
    failure?.retryable === true ? 'retryable' : failure?.retryable === false ? 'not retryable' : undefined,
  ].filter((fact): fact is string => fact !== undefined && fact !== null);
  return [...new Set(facts)].join(' · ');
}

export function nowOf(thread: ThreadSummary): ThreadNow {
  const ending = thread.outcome;
  const failed = ending !== null && (ending.status === 'failed' || ending.status === 'cut');
  return {
    title: thread.title,
    life: thread.life,
    asks: thread.ask === null ? null : cutText(thread.ask.text, SAID_LINE_CHARS),
    failed: failed ? cutText(failureOf(ending), SAID_LINE_CHARS) : null,
    movedAt: thread.updatedAt.toISOString(),
    said: thread.saidLine,
  };
}

export function eventLine(event: SubscribedEvent, reported: boolean): string {
  const who = labelOf(event.thread);
  switch (event.kind) {
    case 'rested':
      if (reported) return `${who} came to rest; its answer reached you as its report`;
      return event.byOperator
        ? `${who} came to rest answering the operator, who spoke with it in this turn${answered(event.words)}`
        : `${who} came to rest${answered(event.words)}`;
    case 'failed':
      return `${who} failed: ${failureOf(event.run)}`;
    case 'stalled':
      return event.stalled.id === event.thread.id
        ? `${who} stalled: no movement since ${clock(event.stalled.since)}`
        : `${who} stalled under it: ${event.stalled.name ?? event.stalled.id} (${event.stalled.id}) has not moved since ${clock(event.stalled.since)}`;
    case 'awaiting':
      return `${who} waits for the operator: ${event.ask.text}`;
    case 'addresses-human':
      return `${who} addresses a human${answered(event.words)}`;
    case 'stopped':
      return `${who} was stopped by the operator`;
    case 'committed':
      return `${who} committed ${event.commit.slice(0, 10)} ${event.subject}`;
    case 'task-closed':
      return `${who} ended task ${event.block} as ${event.word}: ${event.title}`;
  }
}

import type { RunStatus } from '@runlith/agent/transcript/live';
import { canonicalJson } from '@runlith/utils/object';
import type { ThreadAsk, ThreadListRow } from '../contract/wire/list.js';
import type { PresenceChange, PresenceFields, PresenceRow } from '../contract/wire/presence.js';
import type { ThreadSummary } from '../list/summary.js';

export type RunFacts = {
  readonly activeRunStartedAt: ThreadListRow['activeRunStartedAt'];
  readonly ask: ThreadAsk | null;
  readonly saidLine: string | null;
  readonly outcome: ThreadListRow['outcome'];
};

export function runFacts(summary: ThreadSummary): RunFacts {
  const outcome = summary.outcome;
  return {
    activeRunStartedAt: summary.activeRun?.startedAt.toISOString() ?? null,
    ask: summary.ask,
    saidLine: summary.saidLine,
    outcome:
      outcome === null
        ? null
        : {
            runId: outcome.runId,
            status: outcome.status,
            failureReason: outcome.failureReason,
            failure: outcome.failure,
            hostStateFailure: outcome.hostStateFailure,
            finishedAt: outcome.finishedAt.toISOString(),
            isSeen: outcome.isSeen,
          },
  };
}

export function presenceOf(summary: ThreadSummary, status: RunStatus): PresenceRow {
  const running = summary.activeRun;
  return {
    threadId: summary.id,
    status,
    ...runFacts(summary),
    model: running
      ? { provider: running.provider, model: running.model, reasoning: running.reasoning }
      : { provider: summary.provider, model: summary.model, reasoning: summary.reasoning },
    archived: summary.archivedAt !== null,
  };
}

const FIELDS = [
  'status',
  'activeRunStartedAt',
  'ask',
  'saidLine',
  'outcome',
  'model',
  'archived',
] as const satisfies readonly (keyof PresenceFields)[];

type Moved = { -readonly [Field in keyof PresenceFields]?: PresenceFields[Field] };

function carry<Field extends keyof PresenceFields>(moved: Moved, field: Field, after: PresenceRow): void {
  moved[field] = after[field];
}

export function changeOf(before: PresenceRow, after: PresenceRow): PresenceChange | null {
  const moved: Moved = {};
  let any = false;
  for (const field of FIELDS) {
    if (canonicalJson(before[field]) === canonicalJson(after[field])) continue;
    carry(moved, field, after);
    any = true;
  }
  return any ? moved : null;
}

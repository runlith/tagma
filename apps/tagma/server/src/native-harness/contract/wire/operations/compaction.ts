import { Schema } from 'effect';
import { threadCompactResultSchema, threadCompactSchema } from '@runlith/agent/protocol/realtime';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { SETTABLE_SCOPES } from '../../../../platform/contract/wire/setting.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { compactionSummarizersSchema } from '../compactionChoices.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const [started, alreadyRunning, requested] = threadCompactResultSchema.members;

export const COMPACTION_OPERATIONS = {
  read_compaction_summarizers: operation('read_compaction_summarizers', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    callers: 'operator',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    meaning: 'Read the compaction summarizer chain one settings layer resolves to, with the rule that orders it.',
    input: Schema.Struct({ layer: Schema.Literals(SETTABLE_SCOPES) }),
    answer: arms({ read: compactionSummarizersSchema.fields }),
    refusals: ['unknown-project', 'project-required'],
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the ${input.layer} compaction summarizers?` }),
    confirmLabel: 'Read summarizers',
    presentation: { running: 'Reading the compaction summarizers', done: 'Read the compaction summarizers' },
  }),
  compact_thread: operation('compact_thread', {
    approval: ASKS_IN_REVIEW,
    doors: { socket: true, http: false },
    tool: undefined,
    callers: 'operator',
    subject: 'none',
    waits: [],
    lifetimes: [],
    meaning: "Compact a thread's history: now when it rests, at the accepted boundary when a run holds it.",
    grammar:
      "The summarizer resolves as read_compaction_choices answers. A session-capable transport compacts in its vendor session when the thread's own model summarizes: a requested step folds the context at the next step of the running turn, or after the turn when no step comes. A foreign-only transport always uses another provider; its default uses the configured chain regardless of cache warmth, and an empty or unspendable chain has no summarizer. Another model summarizes the thread's history between turns, so a step it is asked for answers requested at end; the next turn opens a new vendor session from the folded history. A thread whose transport declares no compaction refuses transport-cannot.",
    place: 'project',
    input: Schema.Struct({ threadId: ThreadId, ...threadCompactSchema.fields }),
    answer: arms({
      started: { runId: started.fields.runId },
      'already-running': { runId: alreadyRunning.fields.runId },
      requested: { requestId: requested.fields.requestId, at: requested.fields.at, runId: requested.fields.runId },
    }),
    refusals: [
      'unknown-project',
      'not-found',
      'foreign-project',
      'thread-gone',
      'transport-cannot',
      'unknown-summarizer',
      'no-summarizer',
      'summary-failed',
      'compaction-off',
      'compaction-conflict',
      'compaction-failed',
      'harness-contract',
      'thread-running',
      'session-uncertain',
      'act-id-reused',
      'run-active',
    ],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Compact ${input.threadId}?` }),
    confirmLabel: 'Compact',
    presentation: { running: 'Compacting a thread', done: 'Compacted a thread' },
  }),
};

export type CompactionOperationId = keyof typeof COMPACTION_OPERATIONS;

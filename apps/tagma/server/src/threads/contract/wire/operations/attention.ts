import { Schema } from 'effect';
import { PAGE_CURSOR } from '@runlith/paging';
import { arms, operation, type DeclaredAnswer } from '../../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { ATTENTION, attentionRowSchema } from '../attention.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

export const ATTENTION_OPERATIONS = {
  read_attention: operation('read_attention', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'threads' },
    subject: 'none',
    place: 'machine',
    graph: 'none',
    waits: [],
    lifetimes: [],
    subjects: () => [],
    effect: 'read',
    identity: 'none',
    callers: 'any',
    answer: arms({
      ok: { rows: Schema.Array(attentionRowSchema), total: Schema.Int, cursor: Schema.NullOr(Schema.String) },
    }),
    meaning:
      "The operator's threads in every project that need a human, newest first: awaiting an answer, failed or cut and not seen, and finished and not seen.",
    grammar:
      "`kind` is `awaiting` (a question is open), `failed` (the latest run failed or was cut and its run is not marked seen — a child counts) or `finished` (a root thread whose latest run completed and is not marked seen; a child's ending reaches its parent as a report). `at` is when the question was asked or the run ended. `runId` names the run the operator's mark_thread_seen takes; reading leaves every mark as it stood. A thread whose run is going and asks nothing is not listed; archived threads are not listed.",
    input: Schema.Struct({ limit: limitOf(ATTENTION), cursor: PAGE_CURSOR }),
    refusals: ['bad-cursor', 'cursor-stale'],
    confirmation: () => ({ summary: 'Read the threads that need you?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the threads that need you', done: 'Read the threads that need you' },
  }),
} as const;

export type AttentionOperationId = keyof typeof ATTENTION_OPERATIONS;
export type AttentionAnswer = DeclaredAnswer<(typeof ATTENTION_OPERATIONS)['read_attention']['answer']>;

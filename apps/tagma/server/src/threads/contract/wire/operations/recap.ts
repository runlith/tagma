import { Schema } from 'effect';
import { threadInput } from '../project.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { recapReadingSchema } from '../recap.js';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';

export const RECAP_REFUSALS = [
  'not-found',
  'foreign-project',
  'recap-unavailable',
  'recap-running',
  'recap-index-behind',
  'recap-moved',
  'recap-rewritten',
  'recap-selection',
  'recap-model-failed',
  'recap-timeout',
  'recap-tool-call',
  'recap-malformed',
  'recap-too-long',
] as const;
export type RecapRefusal = (typeof RECAP_REFUSALS)[number];

export const RECAP_OPERATIONS = {
  generate_thread_recap: operation('generate_thread_recap', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: undefined,
    callers: 'operator',
    effect: 'write',
    identity: { key: 'call' },
    place: 'project',
    graph: 'none',
    subject: 'none',
    waits: [],
    lifetimes: [],
    subjects: () => [],
    answer: arms({ written: { threadId: ThreadId, recap: recapReadingSchema } }),
    meaning: 'Write a recap of this thread now, independently of automatic recap recording.',
    grammar:
      'The recap is saved and published to the usual thread state and reads. It asks the copy of the last model request the thread holds, warm or cold, and without a copy recaps the journal on the model that writes excerpt titles. A running thread, an incomplete conversation index, a changed model or account, rewritten context, or no model able to recap refuses with its reason and a next step. The conversation stays unchanged.',
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: RECAP_REFUSALS,
    confirmation: (input) => ({ summary: `Write a recap of thread ${input.threadId}?` }),
    confirmLabel: 'Recap',
    presentation: { running: 'Writing a recap', done: 'Wrote a recap' },
  }),
} as const;

export type RecapOperationId = keyof typeof RECAP_OPERATIONS;

import { Schema } from 'effect';
import { family, PageCursor } from '@runlith/paging';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { signerPrincipal } from '../../../../platform/contract/wire/actor.js';
import { arms, operation, type DeclaredAnswer } from '../../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { placeRole } from '../../../../platform/contract/wire/place.js';
import { conversationCoverageSchema, conversationHitSchema, TOTAL_CUTS } from '../conversation.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

export const CONVERSATION_HITS = family('conversation-hits', 1, 'text', { text: 640, json: 1010 }, 20, () => ({
  project: { id: 5, name: 'x'.repeat(12) },
  threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  title: 'x'.repeat(80),
  name: 'x'.repeat(16),
  parentId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  archived: false,
  match: {
    entryId: `user:${'x'.repeat(36)}`,
    position: 12345,
    runId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
    role: 'operator',
    occurredAt: '2026-10-02T20:24:16.059Z',
    snippet: 'x'.repeat(240),
    highlights: [{ start: 80, end: 90 }],
  },
}));

const INSTANT = Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'An ISO instant, e.g. 2026-10-02T00:00:00+02:00.' });

export const SEARCH_OPERATIONS = {
  search_threads: operation('search_threads', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'threads', companions: ['read_thread_record'] },
    callers: 'any',
    subject: 'none',
    place: 'home',
    graph: 'none',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        matches: Schema.Array(conversationHitSchema),
        total: Schema.NullOr(Schema.Int),
        atLeast: Schema.optional(Schema.Int),
        totalCut: Schema.optional(Schema.Literals(TOTAL_CUTS)),
        coverage: conversationCoverageSchema,
        excluded: Schema.NullOr(Schema.String),
        cut: Schema.NullOr(Schema.Literal('match-limit')),
        cursor: Schema.NullOr(PageCursor),
        approximate: Schema.optional(Schema.Literal(true)),
      },
    }),
    meaning:
      'Find what was said in native threads — the operator’s messages and the agents’ answers, in any project — newest first: one row per thread with its latest matching message, a snippet around the match, its time and the address read_thread_record opens with `conversation: true`.',
    grammar: `Every word of \`query\` must stand in one message. English and Russian words match their other forms (trips finds trip, Черногория finds Черногорию); any other language, an identifier or a path matches as written, Chinese and Japanese included. A word shorter than three characters is checked only among messages a longer word found, and a query of short words alone refuses \`query-too-short\`. When no message holds the words as written, words of four letters or more are searched by their nearest spellings among recent matches — one typo, two from eight letters — and the answer says \`approximate: true\`. The operator's words count wherever they were sent, a steer into a running turn included. Tool output, reasoning, system prompts, keep-warm turns and reports arriving from other threads are not indexed: a child's report is found in the child's own thread.
\`since\`/\`before\` bound the time of the message, \`since\` inclusive; "today" or "yesterday" is the operator's day turned into explicit instants. \`threadId\` answers every matching message of that one thread. Your own thread is left out unless \`threadId\` names it, and \`excluded\` says so; archived threads are included.
\`total\` counts the rows of the whole selection for as long as its own time allows; past that it is null beside \`atLeast\` and \`totalCut: count-limit\`, a lower bound and never a count. A query with a short word is not counted ahead: \`total\` is null with \`totalCut: short-terms\` and \`atLeast\` the rows answered so far, and the last page answers the total. \`cut: match-limit\` is a page that stopped short at the matches it may look past and continues from its cursor. \`coverage.complete\` false names how many threads of the scope the index does not hold yet: then no match means no match among what is indexed, never that the conversation did not happen.`,
    input: Schema.Struct({
      query: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The words a message must hold.' }),
      projects: Schema.optional(
        Schema.Union([Schema.Literals(['current', 'all']), Schema.Array(Schema.String.check(Schema.isMinLength(1)))]),
      ).annotate({
        description: 'current (default): this thread’s own project; all: every project on this machine; or projects by name or id.',
      }),
      since: Schema.optional(INSTANT),
      before: Schema.optional(INSTANT),
      threadId: Schema.optional(ThreadId.annotate(placeRole('mention'))).annotate({
        description: 'Answer every matching message of this one thread.',
      }),
      cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The `cursor` the previous page answered; a changed query or scope refuses `cursor-stale`.',
      }),
      limit: limitOf(CONVERSATION_HITS),
    }),
    refusals: [
      'query-too-short',
      'selection-shape',
      'unknown-project',
      'ambiguous-project',
      'cursor-stale',
      'read-unreadable',
      'read-inaccessible',
      'read-failed',
      'read-not-retained',
    ],
    confirmation: (input) => ({ summary: `Search the conversations for "${input.query}"?` }),
    confirmLabel: 'Search',
    presentation: {
      running: 'Searching the conversations',
      done: 'Searched the conversations',
      many: (count) => `Searched the conversations ${count} times`,
    },
    subjects: (input, _prepared, actor) =>
      actor.kind === 'operator'
        ? []
        : [{ kind: 'read' as const, value: threadAgentSubject(signerPrincipal(actor), input.threadId ?? '*') }],
  }),
} as const;

export type SearchOperationId = keyof typeof SEARCH_OPERATIONS;
export type SearchAnswer = DeclaredAnswer<(typeof SEARCH_OPERATIONS)['search_threads']['answer']>;
export const SEARCH_OPERATION_IDS = Object.keys(SEARCH_OPERATIONS) as readonly SearchOperationId[];

import { Schema } from 'effect';
import { PageCursor, pageRows } from '@runlith/paging';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { ceilingOf, limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { blockAnswerSchema, eventRowSchema, listingFacts, overviewFields } from '../answers.js';
import { holderStandingSchema } from '../holders.js';
import { blockMention, blockRef, codePlace } from '../fields.js';
import { placedCursor, placeRole } from '../../../../platform/contract/wire/place.js';
import { BLOCK_SORT_KEYS, blockQuerySchema } from '../query.js';
import { typeSelectorSchema } from '../tags/selector.js';
import { blockListRowSchema } from '../reads.js';
import { blockReadSchema } from '../rows.js';
import { farHoldSchema } from '../far.js';
import { BLOCKS, EVENTS, EVENTS_PAGE_SIZE, GAUGES, GRAPH_DIRECT_READ, GRAPH_READ, TASKS, noSubjects, graphInput } from './shared.js';

export const readyTaskSchema = Schema.Struct({
  ...blockAnswerSchema.fields,
  author: Schema.NullOr(Schema.String),
  holder: Schema.optional(Schema.String),
  standing: Schema.optional(holderStandingSchema),
  workless: Schema.optional(Schema.Literal(true)),
});
export type ReadyTaskAnswer = typeof readyTaskSchema.Type;

const SEARCH_GRAMMAR = `- Matches all query terms, not necessarily a phrase. Titles rank above bodies; fresh blocks above stale ones within a tier.
- Terms shorter than three characters are ignored; no remaining terms lists the freshest blocks.
- When no block holds every term, words of four letters or more are searched by their nearest spellings in the graph — one typo, two from eight letters — and the page answers \`approximate: true\`.
- Cyrillic matches word forms; other scripts match literal substrings. Use base forms: "gate" finds "gates", not vice versa. No transliteration; mixed-script queries require every term.
- Hex-only queries look up identity suffixes, then carried names, then text mentions; identity lookup includes replaced blocks.
- By default, hides ended work and replaced blocks. Use \`history\` or a historical status; "superseded" is not a status.
- Query text includes anchor paths. The \`path\` filter instead requires an anchor on that file or under that directory.
- \`tag\` selects an exact type. Alternatively, \`selector\` selects exact types, types with descendants, or a supported contract, with the same grammar as query_blocks.
- The page is \`limit\` rows, ${pageRows(undefined, BLOCKS, ceilingOf(BLOCKS))} by default and ${ceilingOf(BLOCKS)} at most: it answers that page, the total match count, and the \`cursor\` that continues the reading. Hand back the cursor alone to continue the same filters; a different question refuses it, so omit the cursor to begin anew.`;

const QUERY_GRAMMAR = `Filters are optional: OR within lists, AND between fields; empty lists refuse.
- \`selector\`: {kind: "exact", types: [...]} selects only those types; "descendants" includes their subtypes; {kind: "supports", contract: "core/..."} selects types supporting the registered contract. Type words at this door accept keys, permanent ids and unique aliases. Stored queries pin permanent ids. \`tags\` is an exact selection; choose tags or selector.
- \`scope\`: subtrees, roots included.
- \`anchorPaths\`: any anchor lies within a project-relative path, matched on segment boundaries. Unanchored blocks do not match. \`withoutAnchorPaths\`: no anchor lies within any listed path.
- \`edge\`: choose exactly one direction — \`to\` for an outgoing edge, \`from\` for an incoming edge. One hop unless \`transitive: true\`.
- \`assigneeSessionId\`: task holder. \`since\`: ISO last-touch lower bound. Boolean filters select measured facts.
- \`sort\` is required on the first page; a cursor handed back alone continues its query and sort. Ties use id in the same direction. \`ended\` uses the ending journal entry. \`limit\` is the page — ${pageRows(undefined, BLOCKS, ceilingOf(BLOCKS))} rows where you name none and ${ceilingOf(BLOCKS)} at most at this door, while a stored view keeps the limit it was saved with — and \`total\` counts every match behind it. A cursor handed to another question or another sort is refused.
Hides resting work, answered reflections and replaced blocks unless selected by historical status, \`answered\`, \`superseded\` or \`includeResting\`. Returns rows without bodies.`;

export const READ_OPERATIONS = {
  read_tags: operation('read_tags', {
    ...GRAPH_READ,
    meaning:
      'Read this project’s installed catalog workflows and complete tag declarations, including their writing guidance, fields, roles and constraints.',
    grammar:
      'Read before writing a node whose tags you do not know: a project declares its own tags, and the fields, the status words and the transitions a write is held to are that declaration’s. The catalogs switched on are named, and a `#tag` node that could not be read is named with its reason.',
    input: graphInput({}),
    answer: arms({ ok: overviewFields }),
    refusals: ['project-required', 'unknown-project', 'ambiguous-project', 'field-invalid', 'field-target', 'not-found', 'deleted'],
    confirmation: () => ({ summary: 'Read the tags this project declares and what each one binds?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading the tag vocabulary',
      done: 'Read the tag vocabulary',
      many: (count) => `Read the tag vocabulary ${count} times`,
    },
    subjects: noSubjects,
  }),

  search_blocks: operation('search_blocks', {
    ...GRAPH_DIRECT_READ,
    page: BLOCKS,
    meaning: 'Search block titles, bodies and anchor paths. Returns one ranked page.',
    grammar: SEARCH_GRAMMAR,
    input: graphInput({
      query: Schema.optional(Schema.String).annotate({
        description: 'Words to find; omit to list the freshest blocks.',
      }),
      tag: Schema.optional(Schema.String),
      selector: Schema.optional(typeSelectorSchema),
      status: Schema.optional(Schema.String),
      path: Schema.optional(codePlace).annotate({
        description: 'Only blocks whose gauge lies in this place, spelled the way sources are.',
      }),
      history: Schema.optional(Schema.Boolean).annotate({
        description: 'Include resting work and replaced blocks.',
      }),
      cursor: placedCursor,
      limit: limitOf(BLOCKS),
    }),
    answer: arms({
      ok: {
        blocks: Schema.Array(blockListRowSchema),
        total: Schema.Number,
        next: Schema.NullOr(PageCursor),
        approximate: Schema.optional(Schema.Literal(true)),
      },
    }),
    refusals: [
      'bad-cursor',
      'cursor-stale',
      'source-outside',
      'unknown-project',
      'ambiguous-project',
      'global-missing',
      'no-home',
      'not-found',
      'query-shape',
    ],
    confirmation: (input) => ({
      summary: input.query === undefined || input.query === '' ? 'List the freshest blocks?' : `Search blocks for “${input.query}”?`,
    }),
    confirmLabel: 'Read',
    presentation: { running: 'Searching the graph', done: 'Searched the graph', many: (count) => `Searched the graph ${count} times` },
    subjects: noSubjects,
  }),

  query_blocks: operation('query_blocks', {
    ...GRAPH_READ,
    page: BLOCKS,
    meaning:
      'Select blocks by tag, declared field, subtree, edge, anchor path or measured facts. Does not save the query; use search for text matching.',
    grammar: QUERY_GRAMMAR,
    input: graphInput({ ...blockQuerySchema.fields, sort: Schema.optional(blockQuerySchema.fields.sort), cursor: placedCursor }),
    answer: arms({
      ok: {
        blocks: Schema.Array(blockListRowSchema),
        total: Schema.Number,
        next: Schema.NullOr(PageCursor),
        sort: Schema.Struct({
          by: Schema.Literals(BLOCK_SORT_KEYS),
          order: Schema.Literals(['asc', 'desc']),
        }),
      },
    }),
    refusals: ['query-shape', 'not-found', 'deleted', 'bad-cursor', 'cursor-stale', 'source-outside', 'unknown-project'],
    confirmation: () => ({ summary: 'Query blocks by their declared structure and measured facts?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Querying the graph', done: 'Queried the graph', many: (count) => `Queried the graph ${count} times` },
    subjects: noSubjects,
  }),

  read_block: operation('read_block', {
    ...GRAPH_DIRECT_READ,
    meaning:
      'Read full blocks: bodies and size limits, edges, references in both directions, sources, endings and subtree outlines. Executes saved views.',
    grammar:
      'Pass multiple ids in one call, including lists returned by searches or reference updates. All-or-nothing: a refusal identifies the failing block.',
    input: graphInput({
      blockIds: Schema.Array(blockMention).check(Schema.isMinLength(1)).annotate({ description: 'Block ids as printed by graph reads.' }),
      depth: Schema.optional(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
          description: 'Subtree depth of the outline; 1 by default.',
        }),
      ),
      includeResting: Schema.optional(Schema.Boolean).annotate({
        description:
          'Reveal resting children in the outline, and the finished or replaced blocks linking here, instead of applying the standing-work cut.',
      }),
    }),
    answer: arms({ ok: { reads: Schema.Array(blockReadSchema) } }),
    refusals: ['not-found', 'deleted', 'field-invalid', 'query-shape', 'source-outside'],
    confirmation: (input) => ({
      summary: input.blockIds.length === 1 ? `Read ${input.blockIds[0]} whole?` : `Read ${input.blockIds.length} blocks whole?`,
    }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading a block', done: 'Read a block', many: (count) => `Read ${count} blocks` },
    subjects: noSubjects,
  }),

  read_zone: operation('read_zone', {
    ...GRAPH_DIRECT_READ,
    meaning: 'Read a subtree in outline order, with each block’s body and sources, page by page.',
    grammar:
      'Continue with the returned last-block cursor until none remains. Always includes the requested root, even if retired. Hides resting work and replaced descendants; their standing children appear under the nearest standing ancestor. Does not execute views.',
    input: graphInput({
      scopeId: blockRef.annotate({ description: 'The block whose subtree to read; an area for a zone.' }),
      cursor: Schema.optional(Schema.String).annotate({ ...placeRole('cursor'), description: 'The cursor of the page before this one.' }),
    }),
    answer: arms({
      ok: {
        page: Schema.String,
        shown: Schema.Number,
        next: Schema.NullOr(PageCursor),
        total: Schema.Number,
        deliveredTags: Schema.Array(Schema.String),
      },
    }),
    refusals: ['not-found', 'deleted', 'bad-cursor'],
    confirmation: (input) => ({
      summary: `Read the subtree under ${input.scopeId}, page by page?`,
    }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the zone', done: 'Read a zone page', many: (count) => `Read ${count} zone pages` },
    subjects: noSubjects,
  }),

  ready_work: operation('ready_work', {
    ...GRAPH_READ,
    page: TASKS,
    meaning: 'The frontier: open work with no unfinished blocker.',
    grammar:
      "The answer carries the page and the frontier's whole count, so work standing behind the cut is named rather than hidden; each row names when it last moved and the session that wrote it. The frontier also carries work in work whose holder stopped — a child no longer working, or a thread put away or deleted — naming that holder and its standing: it is taken or ended without asking; and open specs with no open or held work left, marked `workless`: each is closed once built. `idle` and `workless` count them in the whole frontier. Work waiting on a block of a project this machine cannot read is held out of the frontier and named in `held`, each group with its ways out.",
    input: graphInput({
      scopeId: Schema.optional(blockRef).annotate({
        description: 'Subtree root; omit for the whole project.',
      }),
      limit: limitOf(TASKS),
      cursor: placedCursor,
    }),
    answer: arms({
      ok: {
        tasks: Schema.Array(readyTaskSchema),
        ...listingFacts,
        held: Schema.optional(Schema.Array(farHoldSchema)),
        idle: Schema.optional(Schema.Number),
        workless: Schema.optional(Schema.Number),
      },
    }),
    refusals: ['not-found', 'deleted', 'source-outside', 'query-shape', 'cross-project', 'unknown-project', 'bad-cursor', 'cursor-stale'],
    confirmation: () => ({ summary: 'Read the ready work frontier?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the frontier', done: 'Read the frontier', many: (count) => `Read the frontier ${count} times` },
    subjects: noSubjects,
  }),

  read_events: operation('read_events', {
    ...GRAPH_READ,
    page: EVENTS,
    meaning: 'Read the project journal, newest first, with each operation’s session and timestamp.',
    grammar:
      'Hand the returned cursor back alone to continue the same block and since position. The total is null because this read does not count the entire journal.',
    input: graphInput({
      blockId: Schema.optional(blockRef).annotate({ description: "One block's history alone." }),
      sinceId: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
        description: 'Read events after this journal position, for catching up; the page still bounds the answer.',
      }),
      cursor: placedCursor,
      limit: limitOf(EVENTS).annotate({
        description: `Entries to answer: ${EVENTS_PAGE_SIZE} on an opening read, ${pageRows(undefined, EVENTS, ceilingOf(EVENTS))} on catch-up; at most ${ceilingOf(EVENTS)}. The next cursor continues the same question.`,
      }),
    }),
    answer: arms({
      ok: {
        events: Schema.Array(eventRowSchema),
        shown: Schema.Number,
        total: Schema.NullOr(Schema.Number),
        next: Schema.NullOr(PageCursor),
        complete: Schema.Boolean,
      },
    }),
    refusals: ['not-found', 'deleted', 'unknown-project', 'bad-cursor', 'cursor-stale'],
    confirmation: (input) => ({
      summary: input.blockId === undefined ? 'Read this project’s journal, newest first?' : `Read what happened to ${input.blockId}?`,
    }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the journal', done: 'Read the journal' },
    subjects: noSubjects,
  }),

  read_owners: operation('read_owners', {
    ...GRAPH_DIRECT_READ,
    meaning: 'Find the narrowest owner of a code path: symbol anchor, then file, then deepest directory anchor.',
    grammar:
      'Read before changing anchored code or investigating a path from doctor. No owner means the code is undocumented; document its ownership under the nearest area. Requires one path, not the whole ownership table.',
    input: graphInput({
      path: codePlace.annotate({
        description: 'A project-relative place, or an absolute path, which names its project: the file or symbol about to be changed.',
      }),
    }),
    answer: arms({ ok: overviewFields }),
    refusals: ['source-outside', 'not-found', 'unknown-project'],
    confirmation: (input) => ({ summary: `Read the owner of ${input.path}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the owners', done: 'Read the owners' },
    subjects: noSubjects,
  }),

  read_gauges: operation('read_gauges', {
    ...GRAPH_READ,
    page: GAUGES,
    meaning: 'List sources, blocks and owning areas for a project-relative path.',
    grammar:
      'Use before moving sources or splitting files. Sources answer in pages with a total; active touches are whole for this one path.',
    input: graphInput({
      path: Schema.optional(codePlace).annotate({
        description: 'A project-relative place, or an absolute path, which names its project; omit only when continuing its cursor.',
      }),
      limit: limitOf(GAUGES),
      cursor: placedCursor,
    }),
    answer: arms({
      ok: {
        gauges: Schema.Array(Schema.String),
        ...listingFacts,
      },
    }),
    refusals: ['not-found', 'source-outside', 'unknown-project', 'bad-cursor', 'cursor-stale'],
    confirmation: (input) => ({
      summary: `Read every source standing on ${input.path ?? 'the cursor’s path'}?`,
    }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the gauges on a place', done: 'Read the gauges on a place' },
    subjects: noSubjects,
  }),
};

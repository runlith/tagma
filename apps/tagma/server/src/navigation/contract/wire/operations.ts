import { Schema } from 'effect';
import { family, pageRows } from '@runlith/paging';
import { Answer } from '@runlith/navigation/answer';
import { USE_KINDS, UseKind } from '@runlith/navigation/verdict';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ceilingOf, limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { placedCursor, placeRole, projectField } from '../../../platform/contract/wire/place.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { resolutionSubjects } from '../../../workspace/contract/wire/checkoutReads.js';
import { EngineReading } from './engines.js';

export const ROWS = family('navigation-rows', 1, 'text', { text: 240, json: 340 }, 'ceiling', () => ({
  _tag: 'use',
  path: 'x'.repeat(72),
  line: 12_345,
  column: 48,
  text: 'x'.repeat(120),
  kind: 'implementation',
  within: 'x'.repeat(32),
  via: null,
}));

export const ENGINES = family('navigation-engines', 1, 'json', { text: 520, json: 520 }, 'ceiling', () => ({
  root: 'x'.repeat(96),
  rootId: 'x'.repeat(26),
  engine: 'x'.repeat(96),
  base: false,
  phase: 'serving',
  generation: 12,
  revision: 'x'.repeat(40),
  lag: 120,
  warming: false,
  memory: 4_294_967_296,
  leases: 2,
  questions: 3,
  lastUse: '2026-10-22T02:19:09.161Z',
  failure: null,
  retryAt: null,
}));

const NAVIGATION_TOOL = { capability: 'navigation', direct: true } as const;

const READ = {
  approval: ASKS_NEVER,
  doors: { http: true },
  tool: NAVIGATION_TOOL,
  callers: 'any',
  subject: 'head',
  place: 'project',
  graph: 'none',
  waits: [],
  lifetimes: [],
  effect: 'read',
  identity: 'none',
} as const;

const ASKED_REFUSALS = [
  ...PLACE_REFUSALS,
  'path-outside-tree',
  'target-shape',
  'symbol-missing',
  'symbol-ambiguous',
  'occurrences-unread',
  'navigation-disabled',
  'engine-lost',
  'engine-failed',
  'bad-cursor',
  'answer-expired',
] as const;

const target = {
  project: projectField,
  root: Schema.optional(
    Schema.NonEmptyString.annotate({
      ...placeRole('checkout'),
      description:
        "A registered root's id, or an absolute path you stand in. Omitted: the checkout holding an absolute `path`, else the one this call stands in.",
    }),
  ),
  name: Schema.optional(
    Schema.NonEmptyString.annotate({
      description: 'The symbol: its bare name with `path` and `line`, or `Owner.member` without them.',
    }),
  ),
  path: Schema.optional(
    Schema.NonEmptyString.annotate({
      ...placeRole('value'),
      description: 'The file where `name` stands on `line`: absolute, or relative to the checkout root.',
    }),
  ),
  line: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: 'The 1-based line of `path` where `name` stands.' }),
  ),
};

const TARGET_GRAMMAR = `Name the symbol as \`Owner.member\`, looked for on the owner's value, its instances and the type it hands out (an Effect service's \`['Service']\`), or as \`name\` with \`path\` and \`line\`, an identifier on that line, looked for nearby if the line moved. Several fitting symbols refuse \`symbol-ambiguous\` with candidates as \`path:line\`.
The answer reads the engine's last warm snapshot: \`engine\` names its revision and \`lag\`; occurrences in files changed since, your edits included, are \`unverified: changed\` with current text, and \`stale\` names changed files the verdicts depend on. The first question to a checkout waits for its engine; an engine ending mid-question refuses \`engine-lost\` (ask again), three times in a row \`engine-failed\`.`;

const BOUNDARY_GRAMMAR = `Rows of this symbol come first, with kind, enclosing function and excerpt. Unverified occurrences follow: \`changed\`, \`untyped\`, \`unclear\`, \`alias-cut\` with positions; \`no-adapter\`, \`no-program\`, \`unparsed\`, \`degraded\` as one \`boundary\` row per file and reason with \`matches\`. \`summary.boundary\` counts them all on every page; \`summary.partial\` means part of the checkout was unreadable.`;

const SUMMARY_GRAMMAR = `Other symbols of the name are counted by matches and symbols, strings and comments by matches and files, non-code files in \`summary.outside\`. ${BOUNDARY_GRAMMAR} Without \`kinds\`, zero rows, no boundary and a complete search mean the symbol has no use here.`;

const PAGE_GRAMMAR = `A page is \`limit\` rows, ${pageRows(undefined, ROWS, ceilingOf(ROWS))} by default, ${ceilingOf(ROWS)} at most; \`total\` counts rows, a file boundary being one. Hand the \`cursor\` back alone; once the computed answer expires it refuses \`answer-expired\`: ask again.`;

export const NAVIGATION_OPERATIONS = {
  definition: operation('definition', {
    ...READ,
    page: ROWS,
    meaning:
      'Find where a code symbol is declared, through imports and re-exports, in a checkout (.ts, .tsx, .js, .jsx). Ask it before grepping for a declaration: it follows the import, where `grep` finds every declaration of that name.',
    grammar: `${TARGET_GRAMMAR}
${BOUNDARY_GRAMMAR} A language no engine reads answers its text occurrences by file as \`no-adapter\` boundaries.
${PAGE_GRAMMAR}`,
    input: Schema.Struct({ ...target, limit: limitOf(ROWS), cursor: placedCursor }),
    answer: arms({ answered: Answer.fields }),
    refusals: [...ASKED_REFUSALS],
    subjects: (input) => (input.path === undefined ? [] : resolutionSubjects(input.path)),
    confirmation: (input) => ({ summary: `Find where ${input.name ?? 'the symbol'} is declared?` }),
    confirmLabel: 'Find',
    called: (input) => ({ form: 'none', ...(input.name === undefined ? {} : { title: input.name }) }),
    presentation: {
      running: 'Finding a declaration',
      done: 'Found a declaration',
      many: (count) => `Found ${count} declarations`,
    },
  }),

  uses: operation('uses', {
    ...READ,
    page: ROWS,
    meaning:
      "Find every place a code symbol is used in a checkout — calls, implementations, values passed on, types, imports, aliases — each with its enclosing function, and a verdict for every other text occurrence of its name. Ask it before grepping for who calls, implements or passes a member: `grep` finds the name, this the symbol under any receiver name. Asked on a type, it answers that type's references; its members' calls are each `Owner.member`, as `Store.get`.",
    grammar: `${TARGET_GRAMMAR}
${SUMMARY_GRAMMAR}
\`kinds\` keeps only uses of those kinds (${USE_KINDS.join(', ')}), leaving the others out of rows and counts; unverified rows and boundaries stay.
${PAGE_GRAMMAR}`,
    input: Schema.Struct({
      ...target,
      kinds: Schema.optional(Schema.Array(UseKind)).annotate({ description: 'Only rows of these kinds. Omitted: every kind.' }),
      limit: limitOf(ROWS),
      cursor: placedCursor,
    }),
    answer: arms({ answered: Answer.fields }),
    refusals: [...ASKED_REFUSALS],
    subjects: (input) => (input.path === undefined ? [] : resolutionSubjects(input.path)),
    confirmation: (input) => ({ summary: `Find every use of ${input.name ?? 'the symbol'}?` }),
    confirmLabel: 'Find',
    called: (input) => ({ form: 'none', ...(input.name === undefined ? {} : { title: input.name }) }),
    presentation: {
      running: 'Finding uses',
      done: 'Found uses',
      many: (count) => `Found uses ${count} times`,
    },
  }),

  read_navigation: operation('read_navigation', {
    ...READ,
    place: 'machine',
    tool: undefined,
    page: ENGINES,
    meaning:
      "Read the code navigation engines of this machine: one engine per repository, and a row per checkout it serves with the engine's phase and generation, the checkout's snapshot, leases, queued questions, last use and last failure, beside the machine's budget for them.",
    grammar: `Rows run from the most recently used checkout. \`engine\` names the base checkout of the repository's engine; \`base\` marks that checkout's own row, the only one carrying \`memory\`: the engine's resident bytes at the last measurement, null before the first. Every other worktree is served by the same engine as a layer of its differences from the base; \`idle\` on a row of a running engine is a worktree the engine let go, which its next question takes up again. \`waiting\` is a repository whose engine waits for room while the engines \`budget\` admits answer questions; \`resting\` is an engine that ended and waits until \`retryAt\` before it starts again. \`budget.idle\` is how long a worktree stays unasked before the engine lets its own snapshot go; the engine itself keeps running through idleness.`,
    input: Schema.Struct({ limit: limitOf(ENGINES) }),
    answer: arms({ read: EngineReading.fields }),
    refusals: [],
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the navigation engines of this machine?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading navigation engines',
      done: 'Read navigation engines',
      many: (count) => `Read navigation engines ${count} times`,
    },
  }),
};

export type NavigationOperationId = keyof typeof NAVIGATION_OPERATIONS;

import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from './refusals.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { CHECKOUT_DOORS, CHECKOUT_TOOL, resolutionSubjects } from './checkoutReads.js';
import { CoveredRepositoriesAnswer } from './repositories.js';
import { COMMIT_ID, CommitLocations } from './history.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placeRole, projectField } from '../../../platform/contract/wire/place.js';

export const WORKING_OPERATIONS = {
  read_repositories: operation('read_repositories', {
    approval: ASKS_NEVER,
    doors: CHECKOUT_DOORS,
    tool: CHECKOUT_TOOL,
    callers: 'any',
    subject: 'head',
    place: 'project',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: CoveredRepositoriesAnswer.fields }),
    meaning: 'Read the registered Git stores this project covers, each with the binding a worktree creation is made against.',
    grammar: `Every act that makes a checkout takes a \`repository\` binding — a store identity at the location revision you read — and this is where one comes from.
What you see is what the project's coverage names: \`path\` in another project's checkout reads that project. Which project first registered a store decides nothing here.
\`path\` answers the one store a place belongs to, for a caller holding its own checkout rather than an id. A place outside every covered checkout and a place that is no checkout at all are one answer: nothing. A repository nested inside a covered checkout — a vendored clone, a submodule — is its own store and is not the surrounding one.
A covered store no reading could take does not cancel the answer: it rides \`withheld\` with the reason, beside the stores that answered.
It reads: nothing is registered, minted, moved or condemned by asking.`,
    input: Schema.Struct({
      project: projectField,
      path: Schema.optional(
        Schema.NonEmptyString.annotate({
          ...placeRole('path'),
          description: 'Absolute path of a place you stand in. Omitted: every store this project covers.',
        }),
      ),
    }),
    refusals: [...COVERAGE_REFUSALS, ...REPOSITORY_REFUSALS, ...ROOT_REFUSALS],
    subjects: (input) => (input.path === undefined ? [] : resolutionSubjects(input.path)),
    confirmation: (input) => ({
      summary: input.path === undefined ? 'Read the repositories this project covers?' : `Read the repository at ${input.path}?`,
    }),
    confirmLabel: 'Read repositories',
    presentation: {
      running: 'Reading the repositories',
      done: 'Read the repositories',
      many: (count) => `Read the repositories ${count} times`,
    },
  }),

  locate_commits: operation('locate_commits', {
    approval: ASKS_NEVER,
    doors: CHECKOUT_DOORS,
    tool: CHECKOUT_TOOL,
    callers: 'any',
    subject: 'head',
    place: 'project',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: CommitLocations.fields }),
    meaning:
      "Find which registered project's repository holds each of these commit ids, with its full sha and subject: this project's stores first, then every other project's on the machine.",
    grammar: `Each id is a full or short sha in lowercase hex, 7 to 64 characters; one call answers them all, asking each store once, however many checkouts share it.
An id this project's stores hold is answered from them; the rest are looked for across every other registered project. A short id two commits share in one store, or two stores answer with different commits, is not answered: an ambiguous id never names one of them. Ids nothing holds are left out.
A project or store no reading could take does not cancel the answer: it rides \`unread\` with the reason. With an id in hand, read_commit with the project's checkout reads what the commit changed.`,
    input: Schema.Struct({
      project: projectField,
      commits: Schema.Array(Schema.String.check(Schema.isPattern(COMMIT_ID))).annotate({
        description: 'Commit ids: full or short shas in lowercase hex, 7 to 64 characters.',
      }),
    }),
    refusals: [],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Locate ${input.commits.length} commits?` }),
    confirmLabel: 'Locate commits',
    presentation: {
      running: 'Locating commits',
      done: 'Located commits',
      many: (count) => `Located commits ${count} times`,
    },
  }),
};

export type WorkingOperationId = keyof typeof WORKING_OPERATIONS;
export const WORKING_OPERATION_IDS = Object.keys(WORKING_OPERATIONS) as readonly WorkingOperationId[];

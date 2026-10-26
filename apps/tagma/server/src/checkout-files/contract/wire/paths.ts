import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const FIND_LIMIT = 50;
export const FIND_CEILING = 200;
export const FIND_RECENT = 200;

export const FoundFile = Schema.Struct({
  path: Schema.NonEmptyString,
  positions: Schema.Array(Schema.Int),
});
export type FoundFile = typeof FoundFile.Type;

export const PATH_OPERATIONS = {
  find_files: operation('find_files', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { files: Schema.Array(FoundFile), matched: Schema.Int } }),
    meaning: 'Find files of a checkout by a fuzzy name, for Quick Open: tracked and untracked files git does not ignore, best match first.',
    grammar: `Words in \`query\` are separated by spaces and every word must match. A word matches the file name first, with a better score for contiguous letters and for starts of words, and the whole path next; a word with \`/\` matches the path only. \`positions\` are the indexes of the matched characters in \`path\`.
\`recent\` lists paths the operator opened lately: they rank above equal matches, and with an empty \`query\` they are the answer, in the order given.
\`matched\` counts every file that matched, \`files\` carries the best \`limit\` of them (${FIND_LIMIT} unless asked, ${FIND_CEILING} at most). A newer question about the same checkout cancels an older one still waiting, which then refuses \`superseded\`. The first question about a checkout builds its index; the index follows the tree afterwards and is dropped when nobody asks for a while.`,
    input: Schema.Struct({
      root: Schema.optional(
        Schema.NonEmptyString.annotate({
          ...placeRole('value'),
          description: 'A registered root id or an absolute path; omitted: the project checkout.',
        }),
      ),
      query: Schema.String,
      limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(FIND_CEILING))),
      recent: Schema.optional(Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(FIND_RECENT))),
    }),
    refusals: [...PLACE_REFUSALS, ...GIT_REFUSALS, 'worker-unavailable', 'index-lost', 'superseded'],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Find files matching ${input.query}?` }),
    confirmLabel: 'Find files',
    presentation: {
      running: 'Finding files',
      done: 'Found files',
      many: (count) => `Found files ${count} times`,
    },
  }),
};

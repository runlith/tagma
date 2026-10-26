import { Schema } from 'effect';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const REVEAL_REFUSALS = [...PLACE_REFUSALS, 'path-outside-tree', 'graph-path', 'files'] as const;

export const REVEAL_OPERATIONS = {
  reveal_entry: operation('reveal_entry', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: {} }),
    meaning: "Show a file or directory of a checkout in the machine's file manager: what Reveal in Finder does in the file tree.",
    grammar: `The server runs on the machine the operator sits at, so the file manager opens there: Finder selects the entry on macOS, Explorer on Windows, and the entry's directory opens with the platform's own opener elsewhere. \`path\` is relative to the checkout root and refuses what the other file operations refuse outside it; with no \`root\`, an absolute \`path\` names any entry of the machine, such as a file outside every checkout. An entry that does not exist refuses \`files\`.`,
    input: Schema.Struct({
      root: Schema.optional(
        Schema.NonEmptyString.annotate({
          ...placeRole('value'),
          description: 'A registered root id or an absolute path; omitted: the project checkout.',
        }),
      ),
      path: Schema.NonEmptyString.annotate({
        ...placeRole('value'),
        description: 'Relative to the checkout root; absolute when `root` is omitted.',
      }),
    }),
    refusals: REVEAL_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `Show ${input.path} in the file manager?` }),
    confirmLabel: 'Reveal',
    presentation: {
      running: 'Opening the file manager',
      done: 'Opened the file manager',
      many: (count) => `Opened the file manager ${count} times`,
    },
  }),
};

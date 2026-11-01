import { Schema } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { BlockName } from '../references.js';
import { writerSchema } from '../rows.js';
import { SURFACE_ACT, SURFACE_READ, graphInput } from './shared.js';
import { Place, placeRole } from '../../../../platform/contract/wire/place.js';
import type { ToolShown } from '@runlith/agent/tool';

export type TouchPreparation = {
  readonly groups: readonly { readonly place: typeof Place.Type; readonly shown: readonly ToolShown[] }[];
};

const named = Schema.Struct({ name: BlockName, title: Schema.String });

const namedBlock = Schema.Struct({ ...named.fields, identity: Schema.String });

const touchText = Schema.Struct({ ...namedBlock.fields, revision: Schema.String, body: Schema.String });

const shownAs = Schema.Literals(['read', 'wrote', 'found']);

export const touchBriefSchema = Schema.Struct({
  place: Schema.String,
  as: shownAs,
  rules: Schema.Array(Schema.Struct({ ...touchText.fields, reach: Schema.String })),
  explanations: Schema.Array(touchText),
  tagPrompts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      prompt: Schema.String,
      identity: Schema.String,
      aliases: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  touches: Schema.Array(
    Schema.Struct({ writer: writerSchema, agentName: Schema.NullOr(Schema.String), task: named, wrote: Schema.Boolean }),
  ),
});

const text = { text: Schema.String };

export const ORIENTATION_OPERATIONS = {
  session_start: operation('session_start', {
    ...SURFACE_READ,
    subject: 'none',
    meaning:
      "Read the orientation a foreign CLI's session opens with: the one a native thread opens with, followed by the project's law whole, since the CLI carries no Tagma system prompt.",
    grammar: "In a private project the law opens with Tagma's own law section, which no file of its checkout carries.",
    input: graphInput({}),
    answer: arms({ ok: text }),
    refusals: ['project-required'],
    confirmation: () => ({ summary: 'Read the session orientation?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the session orientation', done: 'Read the session orientation' },
    subjects: () => [],
  }),

  touch_path: operation('touch_path', {
    ...SURFACE_ACT,
    meaning: 'Record the files a session read or wrote, or saw among search results, and answer what the graph says about each place.',
    grammar:
      'Paths are grouped by their registered checkout. Each brief carries its binding rules and who else touched it; search results are not recorded as touched, and paths outside all registered checkouts are skipped. The places name the instruction sets a hook asks guidance to deliver.',
    input: graphInput({
      shown: Schema.Array(Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)).annotate(placeRole('mention')), as: shownAs })),
    }),
    answer: arms({ ok: { briefs: Schema.Array(touchBriefSchema), places: Schema.Array(Place) } }),
    refusals: [
      'project-required',
      'place-mismatch',
      'files',
      'graph-pool',
      'tree-missing',
      'tree-unreadable',
      'not-found',
      'source-outside',
      'git-incomplete',
      'git-refused',
      'git-unreadable',
      'catalog-incomplete',
      'no-root',
      'vocabulary-newer',
      'vocabulary-older',
    ],
    confirmation: (input) => ({ summary: `Record the touch of ${input.shown.map((one) => one.path).join(', ')}?` }),
    confirmLabel: 'Record',
    presentation: { running: 'Recording a touch', done: 'Recorded a touch' },
    subjects: () => [],
  }),
} as const;

export type OrientationOperationId = keyof typeof ORIENTATION_OPERATIONS;

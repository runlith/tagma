import { Schema } from 'effect';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const Editor = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  icon: Schema.NullOr(Schema.String).annotate({ description: 'The application icon as a PNG data URL, null where the system gave none.' }),
});
export type Editor = typeof Editor.Type;

export const OPEN_REFUSALS = [
  ...PLACE_REFUSALS,
  'path-outside-tree',
  'editor-missing',
  'editor-failed',
  'setting-conflict',
  'unknown-setting',
  'setting-managed',
  'setting-scope',
  'setting-value',
] as const;

const operatorOnly = {
  doors: { http: 'perform' },
  callers: 'operator',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
} as const;

export const EDITOR_OPERATIONS = {
  read_editors: operation('read_editors', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning: 'Read which editors of the catalog are installed on the machine the server runs on, and which one "Open in" opens.',
    grammar:
      'The server finds them once at start and again when the answer is older than a few minutes, so this read waits only on a stale answer. `editors` follow the catalog order; `chosen` is the remembered editor when installed, else the first installed, null when none is. `failure` says why the whole search failed; an editor whose own check failed is left out.',
    input: Schema.Struct({}),
    answer: arms({ read: { editors: Schema.Array(Editor), chosen: Schema.NullOr(Schema.String), failure: Schema.NullOr(Schema.String) } }),
    refusals: [],
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the installed editors?' }),
    confirmLabel: 'Read editors',
    presentation: { running: 'Reading the installed editors', done: 'Read the installed editors' },
  }),
  open_in_editor: operation('open_in_editor', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Open a file in an editor installed on the machine the server runs on, at a line, with its checkout as the project.',
    grammar:
      'A relative `path` is a file of the checkout `root` (omitted: the project checkout), which the editor opens as its project; an absolute one opens alone. `editor` names a catalog entry read_editors lists and becomes the remembered choice; omitted, the chosen one opens. An editor gone since it was found refuses `editor-missing`, one whose command fails `editor-failed`; either makes the next read_editors look again.',
    input: Schema.Struct({
      root: Schema.optional(
        Schema.NonEmptyString.annotate({
          ...placeRole('value'),
          description: 'A registered root id or an absolute path; omitted: the project checkout.',
        }),
      ),
      path: Schema.NonEmptyString.annotate({
        ...placeRole('value'),
        description: 'Relative to the checkout root, or absolute for a file outside checkouts.',
      }),
      line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: 'One-based; omitted: 1.' })),
      editor: Schema.optional(Schema.NonEmptyString.annotate({ description: 'A catalog id; omitted: the chosen editor.' })),
    }),
    answer: arms({ opened: { editor: Schema.String } }),
    refusals: OPEN_REFUSALS,
    effect: 'external',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Open ${input.path} in ${input.editor ?? 'the chosen editor'}?` }),
    confirmLabel: 'Open',
    presentation: {
      running: 'Opening the editor',
      done: 'Opened the editor',
      many: (count) => `Opened the editor ${count} times`,
    },
  }),
};

export type EditorOperationId = keyof typeof EDITOR_OPERATIONS;

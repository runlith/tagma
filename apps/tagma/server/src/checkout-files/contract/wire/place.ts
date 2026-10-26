import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const PlacedPath = Schema.Struct({
  projectId: Schema.Int,
  checkout: RootId,
  root: Schema.NonEmptyString,
  path: Schema.String,
});
export type PlacedPath = typeof PlacedPath.Type;

export const PathFile = Schema.Struct({
  kind: Schema.Literal('file'),
  path: Schema.NonEmptyString,
  bytes: Schema.Number,
  mediaType: Schema.String,
});
export type PathFile = typeof PathFile.Type;

export const PathDirectory = Schema.Struct({
  kind: Schema.Literal('directory'),
  path: Schema.NonEmptyString,
});
export type PathDirectory = typeof PathDirectory.Type;

export const PathEntry = Schema.Union([PathFile, PathDirectory]);
export type PathEntry = typeof PathEntry.Type;

export const PREVIEW_BYTES = 64 * 1024;

export const PLACE_OPERATIONS = {
  place_path: operation('place_path', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { entry: Schema.NullOr(PathEntry), place: Schema.NullOr(PlacedPath) } }),
    meaning:
      'Tell the operator what stands at a path — a readable file or a directory — and the checkout of a registered project holding it when there is one.',
    grammar: `\`path\` is absolute, or relative to \`from\`, an absolute directory such as the root a thread works in, or to the checkout \`root\` names; a relative path with neither is relative to the root of the caller's workspace, else to the project's own checkout.
\`entry\` names what stands there by its absolute path, inside or outside every checkout: \`kind: file\` a readable regular file with its size and media type, \`kind: directory\` a readable directory. An absent or unreadable path, or anything else standing there, answers null. \`place\` names the checkout holding that entry — this project's first, else any registered project's on the machine — with its project, the deepest root and the path relative to it, or null when the entry stands outside every checkout or inside git's own directory or the graph's tree; such a file opens through \`file.subscribe\` and saves with write_file.`,
    input: Schema.Struct({
      path: Schema.NonEmptyString.annotate(placeRole('value')),
      from: Schema.optional(Schema.NonEmptyString.annotate({ description: 'Absolute directory a relative path is read from.' })),
      root: Schema.optional(
        Schema.NonEmptyString.annotate({
          ...placeRole('value'),
          description: 'A registered root id whose checkout a relative path is read from.',
        }),
      ),
    }),
    refusals: [...PLACE_REFUSALS, 'files'],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Place ${input.path}?` }),
    confirmLabel: 'Place path',
    presentation: {
      running: 'Placing a path',
      done: 'Placed a path',
      many: (count) => `Placed ${count} paths`,
    },
  }),
};

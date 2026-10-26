import { isAbsolute, relative, resolve } from 'node:path';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { Settings } from '../settings/contract/service/values.js';
import { CheckoutPlaces } from '../workspace/contract/service/checkouts.js';
import { CallerWorkspace } from '../workspace/contract/service/places.js';
import { Editors, type Listing, type Target } from './contract/service/editors.js';
import { EDITOR_OPERATIONS as OPS } from './contract/wire/operations.js';
import { openIn } from './contract/wire/settings.js';

const chosenOf = (listing: Listing, preferred: string): string | null =>
  listing.editors.some((editor) => editor.id === preferred) ? preferred : (listing.editors[0]?.id ?? null);

const targetOf = Effect.fnUntraced(function* (root: string | undefined, path: string, line: number) {
  if (isAbsolute(path) && root === undefined) return { root: null, file: resolve(path), line } satisfies Target;
  const call = yield* yield* CurrentProject;
  const workspace = yield* CallerWorkspace;
  const place = yield* (yield* CheckoutPlaces).placeOf({ projectId: call.project.id, cwd: workspace?.root }, root);
  const file = resolve(place.path, path);
  const inside = relative(place.path, file);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside))
    return yield* new GateRefusal('path-outside-tree', `${path} is not a file of the checkout at ${place.path}`, [
      'name a path relative to the checkout root',
    ]);
  return { root: place.path, file, line } satisfies Target;
});

export const EDITOR_PAIRS = {
  read_editors: pair(
    OPS.read_editors,
    body(OPS.read_editors, {
      execute: Effect.fnUntraced(function* () {
        const listing = yield* (yield* Editors).list;
        const preferred = yield* (yield* Settings).value(openIn);
        return { status: 'read' as const, editors: [...listing.editors], chosen: chosenOf(listing, preferred), failure: listing.failure };
      }),
    }),
  ),

  open_in_editor: pair(
    OPS.open_in_editor,
    body(OPS.open_in_editor, {
      execute: Effect.fnUntraced(function* (input) {
        const editors = yield* Editors;
        const settings = yield* Settings;
        const target = yield* targetOf(input.root, input.path, input.line ?? 1);
        const preferred = yield* settings.value(openIn);
        const editor = input.editor ?? chosenOf(yield* editors.list, preferred);
        if (editor === null)
          return yield* new GateRefusal('editor-missing', 'no editor of the catalog is installed on this machine', [
            'install an editor read_editors would list',
          ]);
        yield* editors.open(editor, target);
        if (input.editor !== undefined && input.editor !== preferred)
          yield* settings.write({ scope: 'user', key: openIn.id, value: editor });
        return { status: 'opened' as const, editor };
      }),
    }),
  ),
};

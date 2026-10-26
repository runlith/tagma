import { Effect } from 'effect';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import { runGit } from '../../platform/git/ownGit.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { CommitShape } from '../contract/service/shape.js';
import type { PreparedEmptied, PreparedRow } from '../contract/service/prepared.js';
import type { Reshaped } from '../contract/wire/reshape.js';
import type { ShapeRefusal } from '../contract/wire/shape.js';
import { emptyTree } from './subject.js';
import { type Built, type Landing, named } from './tree.js';

export type Finished<Row extends PreparedRow> = Built<Row> & {
  readonly from: string;
  readonly reshaped: readonly Reshaped[];
  readonly formatSkipped: boolean;
  readonly declaration: readonly string[];
};

export type Shaping<Row extends PreparedRow> =
  | { readonly _tag: 'shaped'; readonly finished: Finished<Row> }
  | { readonly _tag: 'emptied'; readonly emptied: PreparedEmptied };

export const shapeBuilt = Effect.fn('prepared.shape')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  built: Built<Row>,
  shape: CommitShape['Service'],
): Effect.fn.Return<Shaping<Row>, OwnGitFailed | GateRefusal<ShapeRefusal | 'landing-busy'>> {
  const { git, root, input, job } = landing;
  const base = built.base ?? (yield* emptyTree(git, root));
  const shaped = yield* shape.shape({
    projectId: landing.projectId,
    git,
    root,
    gitDir: landing.gitDir,
    commonDir: landing.commonDir,
    act: landing.act,
    base,
    tree: built.tree,
    job,
    skipping: input.withoutFormat === true,
  });
  const formatSkipped = shaped.skipped;
  const { declaration } = shaped;
  if (shaped.tree === built.tree)
    return { _tag: 'shaped', finished: { ...built, from: built.tree, reshaped: [], formatSkipped, declaration } };
  const listed = yield* runGit(git, 'submit-shaped-changed', [
    '-C',
    root,
    'diff-tree',
    '-r',
    '-z',
    '--name-only',
    '--no-renames',
    base,
    shaped.tree,
  ]);
  const changed = named(listed);
  if (changed.length === 0) {
    return { _tag: 'emptied', emptied: { base: built.base, reshaped: shaped.reshaped, ids: built.plan.flatMap((one) => one.ids) } };
  }
  return {
    _tag: 'shaped',
    finished: { ...built, tree: shaped.tree, changed, from: built.tree, reshaped: shaped.reshaped, formatSkipped, declaration },
  };
});

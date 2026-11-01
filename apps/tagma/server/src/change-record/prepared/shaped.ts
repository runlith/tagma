import { Effect } from 'effect';
import { OwnGitFailed, actingGit, runGit } from '../../platform/git/ownGit.js';
import { treeEntriesAt } from '@runlith/git/entries';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { CommitShape } from '../contract/service/shape.js';
import type { PreparedEmptied, PreparedRow } from '../contract/service/prepared.js';
import type { Reshaped } from '../contract/wire/reshape.js';
import type { ShapeRefusal } from '../contract/wire/shape.js';
import { emptyTree } from './subject.js';
import { type Built, type Landing, named } from './tree.js';
import { derivationOf } from './deriving.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';

export type Finished<Row extends PreparedRow> = Built<Row> & {
  readonly from: string;
  readonly reshaped: readonly Reshaped[];
  readonly formatSkipped: boolean;
  readonly declaration: readonly string[];
  readonly derived: readonly string[];
};

export type Shaping<Row extends PreparedRow> =
  | { readonly _tag: 'shaped'; readonly finished: Finished<Row> }
  | { readonly _tag: 'emptied'; readonly emptied: PreparedEmptied };

export const shapeBuilt = Effect.fn('prepared.shape')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  built: Built<Row>,
  shape: CommitShape['Service'],
  merging = false,
): Effect.fn.Return<Shaping<Row>, OwnGitFailed | StoreFailure | GateRefusal<ShapeRefusal | 'landing-busy' | 'walk-cut'>> {
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
    merging,
    derive: input.derive,
    derivation: (declared) =>
      derivationOf(landing, built, declared).pipe(
        Effect.mapError((failure) =>
          failure instanceof OwnGitFailed || failure instanceof GateRefusal
            ? failure
            : new GateRefusal('walk-cut', `the derivation's program-origin and holder evidence could not be read: ${failure.message}`, [
                'submit again once the change record reads',
                'leave the derived outputs out of this landing',
              ]),
        ),
      ),
  });
  const formatSkipped = shaped.skipped;
  const { declaration } = shaped;
  const derived = shaped.derived ?? [];
  if (shaped.tree === built.tree)
    return { _tag: 'shaped', finished: { ...built, from: built.tree, reshaped: [], formatSkipped, declaration, derived } };
  let from = built.tree;
  if (derived.length > 0) {
    const entries = yield* treeEntriesAt(actingGit(git, 'submit-derived-source'), root, shaped.tree, derived);
    if (entries.unread.size > 0)
      return yield* new OwnGitFailed({
        op: 'submit-derived-source',
        message: [...entries.unread].map(([path, reason]) => `${path}: ${reason}`).join('; '),
        ran: true,
      });
    yield* runGit(git, 'submit-derived-source', ['-C', root, 'update-index', '-z', '--index-info'], {
      env: { GIT_INDEX_FILE: landing.index },
      stdin: derived
        .map((path) => {
          const entry = entries.entries.get(path);
          return entry === undefined ? `0 ${'0'.repeat(shaped.tree.length)}\t${path}\0` : `${entry.mode} ${entry.object}\t${path}\0`;
        })
        .join(''),
    });
    from = yield* runGit(git, 'submit-derived-source', ['-C', root, 'write-tree'], { env: { GIT_INDEX_FILE: landing.index } });
  }
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
    return {
      _tag: 'emptied',
      emptied: {
        base: built.base,
        reshaped: shaped.reshaped,
        ids: built.plan.filter((one) => !derived.includes(one.path)).flatMap((one) => one.ids),
      },
    };
  }
  return {
    _tag: 'shaped',
    finished: { ...built, tree: shaped.tree, changed, from, reshaped: shaped.reshaped, formatSkipped, declaration, derived },
  };
});

import { Effect } from 'effect';
import { runGit } from '../../platform/git/ownGit.js';
import type { DerivationNeed } from '../contract/service/shape.js';
import type { PreparedRow } from '../contract/service/prepared.js';
import type { Built, Landing } from './tree.js';

export const derivationOf = Effect.fn('prepared.derivation')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  built: Built<Row>,
  declared: boolean,
) {
  if (!declared) return undefined;
  const changed = new Set(built.changed);
  const paths = built.plan.filter((one) => changed.has(one.path)).map((one) => one.path);
  if (paths.length === 0) return undefined;
  const { git, root, index } = landing;
  const env = { GIT_INDEX_FILE: index };
  const differences = yield* Effect.all(
    [
      runGit(
        git,
        'submit-derived-excluded',
        ['-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--relative', '-z', '--'],
        {
          env,
          cleans: true,
        },
      ),
      runGit(git, 'submit-derived-untracked', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z'], { env, cleans: true }),
    ],
    { concurrency: 2 },
  );
  const omitted = [...new Set(differences.flatMap((one) => one.split('\0').filter((path) => path !== '')))];
  if ((yield* landing.fns.eligiblePaths(git, root, omitted)).length === 0) return undefined;
  return { paths } satisfies DerivationNeed;
});

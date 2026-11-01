import { and, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { runGit } from '../../platform/git/ownGit.js';
import { holderKey } from '../../workspace/contract/wire/checkout.js';
import type { DerivationNeed } from '../contract/service/shape.js';
import type { PreparedRow } from '../contract/service/prepared.js';
import { workspaceChange } from '../store/tables.js';
import { PLACES_PER_STATEMENT } from '../record/places.js';
import { chunk } from '@runlith/utils/collection';
import { derivedPaths } from './programmatic.js';
import { observedPrograms } from '../record/programOrigins.js';
import type { Built, Landing } from './tree.js';

export const derivationOf = Effect.fn('prepared.derivation')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  built: Built<Row>,
  declared: boolean,
) {
  const changed = new Set(built.changed);
  const plan = built.plan.filter((one) => changed.has(one.path));
  if (plan.length === 0) return undefined;
  const judgedOutputs = yield* landing.fns.judged(
    landing,
    plan.map((one) => one.path),
  );
  const recognized = yield* derivedPaths(landing, plan, judgedOutputs);
  if (recognized.length === 0 && !declared) return undefined;
  const paths = plan.map((one) => one.path);
  const { git, root, index } = landing;
  const env = { GIT_INDEX_FILE: index };
  const differences = yield* Effect.all(
    [
      runGit(
        git,
        'submit-derived-excluded',
        ['-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--relative', '-z', '--'],
        { env, cleans: true },
      ),
      runGit(git, 'submit-derived-untracked', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z'], { env, cleans: true }),
    ],
    { concurrency: 2 },
  );
  const omitted = [...new Set(differences.flatMap((one) => one.split('\0').filter((path) => path !== '')))];
  const eligible = yield* landing.fns.eligiblePaths(git, root, omitted);
  if (eligible.length === 0) return undefined;
  const judged = yield* landing.fns.judged(landing, eligible);
  const excluded = eligible.map((path) => {
    const verdict = judged.get(path)?.holding.verdict;
    const holders =
      verdict === undefined
        ? []
        : verdict.verdict === 'proven'
          ? verdict.hands.filter((hand) => !hand.retired).map((hand) => holderKey(hand.holder))
          : verdict.writers.map(holderKey);
    if (holders.length === 0 || (verdict?.verdict === 'proven' && verdict.nobody.length > 0)) holders.push('nobody');
    return { path, holders };
  });
  const derived = new Set(recognized);
  const ids = plan.filter((one) => derived.has(one.path)).flatMap((one) => one.ids);
  const commands = new Set<string>();
  for (const group of chunk(ids, PLACES_PER_STATEMENT)) {
    const rows = yield* landing.units.read((unit) =>
      unit.run(
        landing.store.db
          .select({ line: workspaceChange.commandLine })
          .from(workspaceChange)
          .where(and(inArray(workspaceChange.id, group), sql`${workspaceChange.provenance} in ('command', 'command-whole')`)),
      ),
    );
    for (const row of rows) if (row.line !== null) commands.add(row.line);
  }
  for (const origins of (yield* observedPrograms(landing, recognized)).values())
    for (const origin of origins) if (origin.commandLine !== null) commands.add(origin.commandLine);
  return { paths, recognized, excluded, commands: [...commands] } satisfies DerivationNeed;
});

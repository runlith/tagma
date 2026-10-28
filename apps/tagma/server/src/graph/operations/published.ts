import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import { runGit } from '../../platform/git/ownGit.js';
import type { BlockRow } from '../contract/service/acts.js';
import { CurrentGraph } from '../contract/service/serving.js';
import { blockName } from '../contract/wire/references.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';

export type Published = { readonly published?: readonly string[]; readonly publishedUnread?: string };

const committedFiles = Effect.fnUntraced(function* (git: Git['Service'], checkout: string) {
  const head = yield* commitOf(git, checkout, 'HEAD');
  if (head === null) return new Set<string>();
  const listed = yield* runGit(git, 'published-files', [
    '-C',
    checkout,
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    head,
    '--',
    CHECKOUT_DIRECTORY,
  ]);
  return new Set(listed.split('\0'));
});

export const publishedOf = Effect.fnUntraced(function* (rows: readonly BlockRow[]): Effect.fn.Return<Published, never, Git> {
  const graph = yield* CurrentGraph;
  const team = rows.filter((row) => !row.stealth && row.path !== null);
  if (graph === null || graph.layout.mode !== 'team' || team.length === 0) return {};
  const read = yield* Effect.result(committedFiles(yield* Git, graph.checkout));
  if (read._tag === 'Failure') return { publishedUnread: read.failure.message };
  const named = team.filter((row) => read.success.has(`${CHECKOUT_DIRECTORY}/${row.path}`)).map((row) => blockName(row.uuid));
  return named.length === 0 ? {} : { published: named };
});

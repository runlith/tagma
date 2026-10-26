import type { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { runGit, type OwnGitFailed } from '../platform/git/ownGit.js';
import type { TreePlace } from '../workspace/contract/service/commitTrees.js';
import type { FormatCommand } from '../config/contract/wire/config.js';
import type { Entry } from './running.js';

export type Candidate = { readonly path: string; readonly entry: Entry };

const REGULAR = new Set(['100644', '100755']);

const ABSENT = '000000';

const nul = (paths: readonly string[]): string => paths.map((path) => `${path}\0`).join('');

export const candidatesOf = Effect.fn('commitSteps.candidates')(function* (
  git: Git['Service'],
  root: string,
  base: string,
  tree: string,
  graphDirectory: string,
): Effect.fn.Return<readonly Candidate[], OwnGitFailed> {
  const fields = (yield* runGit(git, 'commit-steps-candidates', [
    '-C',
    root,
    'diff-tree',
    '-r',
    '-z',
    '--raw',
    '--numstat',
    '--no-abbrev',
    '--no-renames',
    '--no-ext-diff',
    base,
    tree,
  ])).split('\0');
  const raw: (readonly [string, string])[] = [];
  const binary = new Set<string>();
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? '';
    if (field.startsWith(':')) raw.push([field, fields[++at] ?? '']);
    else if (field.startsWith('-\t-\t')) binary.add(field.slice(4));
  }
  const found: Candidate[] = [];
  for (const [entry, path] of raw) {
    const [, newMode = '', , sha = ''] = entry.slice(1).split(' ');
    if (path === '' || newMode === ABSENT || !REGULAR.has(newMode) || binary.has(path)) continue;
    if (path === graphDirectory || path.startsWith(`${graphDirectory}/`)) continue;
    found.push({ path, entry: { sha, mode: newMode === '100755' ? '100755' : '100644' } });
  }
  return found;
});

type Pattern = { readonly glob: Bun.Glob; readonly base: boolean };

export type Selector = { readonly kept: readonly Pattern[]; readonly dropped: readonly Pattern[] };

const patternOf = (text: string): Pattern => ({ glob: new Bun.Glob(text), base: !text.includes('/') });

const hits = (patterns: readonly Pattern[], path: string): boolean =>
  patterns.some((pattern) => pattern.glob.match(pattern.base ? path.slice(path.lastIndexOf('/') + 1) : path));

export const selectorOf = (command: FormatCommand): Selector => ({
  kept: command.files.filter((text) => !text.startsWith('!')).map(patternOf),
  dropped: command.files.filter((text) => text.startsWith('!')).map((text) => patternOf(text.slice(1))),
});

export const globbed = (selector: Selector, candidates: readonly Candidate[]): readonly string[] =>
  candidates.filter((one) => hits(selector.kept, one.path) && !hits(selector.dropped, one.path)).map((one) => one.path);

export const filtered = Effect.fn('commitSteps.filtered')(function* (
  git: Git['Service'],
  place: TreePlace,
  paths: readonly string[],
): Effect.fn.Return<ReadonlySet<string>, OwnGitFailed> {
  const filtered = new Set<string>();
  if (paths.length === 0) return filtered;
  const answer = yield* runGit(git, 'commit-steps-filters', ['-C', place.dir, 'check-attr', '-z', '--stdin', 'filter'], {
    env: { ...place.env },
    stdin: nul(paths),
    cleans: true,
  });
  const fields = answer.split('\0');
  for (let at = 0; at + 2 < fields.length; at += 3) if (fields[at + 2] !== 'unspecified') filtered.add(fields[at] as string);
  return filtered;
});

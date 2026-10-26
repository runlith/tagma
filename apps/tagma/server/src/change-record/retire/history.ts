import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { runGit, type OwnGitFailed } from '../../platform/git/ownGit.js';
import type { HeadSide, IntroducedSides } from '../contract/service/holdings.js';

export type SeenCommit = {
  readonly commit: string;
  readonly parents: readonly string[];
  readonly paths: readonly string[];
  readonly sides: ReadonlyMap<string, IntroducedSides>;
};

export type SeenHistory = {
  readonly commits: readonly SeenCommit[];
  readonly ancestors: (tip: string) => ReadonlySet<string>;
};

const ABSENT = /^0+$/;

const sideOf = (mode: string, oid: string): HeadSide => (ABSENT.test(mode) ? { kind: 'absent' } : { kind: 'blob', oid, mode });

const parsed = (logged: string): readonly SeenCommit[] => {
  const commits: {
    readonly commit: string;
    readonly parents: readonly string[];
    readonly paths: string[];
    readonly sides: Map<string, IntroducedSides>;
  }[] = [];
  let header = true;
  let meta: string | null = null;
  for (const token of logged.split('\0')) {
    if (meta !== null) {
      const [before = '', after = '', older = '', newer = ''] = meta.slice(1).split(' ');
      const current = commits[commits.length - 1];
      if (current !== undefined && token !== '') {
        current.paths.push(token);
        current.sides.set(token, { before: sideOf(before, older), after: sideOf(after, newer) });
      }
      meta = null;
      continue;
    }
    if (token === '') {
      header = true;
      continue;
    }
    const line = token.startsWith('\n') ? token.slice(1) : token;
    if (header) {
      const [commit = '', ...parents] = line.trim().split(' ');
      commits.push({ commit, parents: parents.filter((one) => one !== ''), paths: [], sides: new Map() });
      header = false;
      continue;
    }
    if (line.startsWith(':')) meta = line;
  }
  return commits;
};

export const historySince = (
  git: Git['Service'],
  root: string,
  from: string | null,
  head: string,
  tips: readonly string[],
): Effect.Effect<SeenHistory, OwnGitFailed> =>
  Effect.map(
    runGit(git, 'retire-history', [
      '-C',
      root,
      'log',
      '--ignore-missing',
      '--reverse',
      '--topo-order',
      '--root',
      '--format=%x00%H %P',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      '-z',
      '--diff-merges=first-parent',
      '--end-of-options',
      head,
      ...new Set(tips.filter((tip) => tip !== head && tip !== from)),
      ...(from === null ? [] : [`^${from}`]),
      '--',
    ]),
    (logged) => {
      const commits = parsed(logged);
      const graph = new Map(commits.map((one) => [one.commit, one.parents] as const));
      const known = new Map<string, ReadonlySet<string>>();
      const ancestors = (tip: string): ReadonlySet<string> => {
        const memo = known.get(tip);
        if (memo !== undefined) return memo;
        const reached = new Set<string>();
        const pending = [tip];
        while (pending.length > 0) {
          const next = pending.pop() as string;
          if (reached.has(next)) continue;
          reached.add(next);
          for (const parent of graph.get(next) ?? []) pending.push(parent);
        }
        known.set(tip, reached);
        return reached;
      };
      const reachable = ancestors(head);
      return { commits: commits.filter((one) => reachable.has(one.commit)), ancestors };
    },
  );

export const unreached = (
  git: Git['Service'],
  root: string,
  head: string,
  commits: readonly string[],
): Effect.Effect<ReadonlySet<string>, OwnGitFailed> =>
  commits.length === 0
    ? Effect.succeed(new Set<string>())
    : Effect.map(
        runGit(git, 'retire-proof', ['-C', root, 'rev-list', '--no-walk', '--stdin'], {
          stdin: `${[...new Set(commits)].join('\n')}\n^${head}\n`,
        }),
        (answer) => new Set(answer.split('\n').filter((commit) => commit !== '')),
      );

export const commonBase = (git: Git['Service'], root: string, heads: readonly string[]): Effect.Effect<string, OwnGitFailed> =>
  runGit(git, 'retire-base', ['-C', root, 'merge-base', '--octopus', '--end-of-options', ...new Set(heads)]);

import { access } from 'node:fs/promises';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import {
  type GitAnswerInvalid,
  type GitRefused,
  type GitUnreadable,
  type Head,
  type Layout,
  headAt,
  layoutAt,
  standingAt,
} from '@runlith/git/repository';
import { actingGit, OwnGitFailed, readingFailed } from './ownGit.js';

const OPERATIONS = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply/applying', 'am'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
] as const;

export type OpenOperation = (typeof OPERATIONS)[number][1];

export type GitPlaces = {
  readonly gitDir: string;
  readonly commonDir: string;
  readonly index: string;
  readonly hooks: string;
  readonly operations: readonly string[];
};

export type Standing = { readonly places: GitPlaces; readonly head: Head };

const NAMES = ['index', 'hooks', ...OPERATIONS.map(([name]) => name)];

const placesIn = ({ gitDir, commonDir, paths }: Layout): GitPlaces => {
  const [index = '', hooks = '', ...operations] = paths;
  return { gitDir, commonDir, index, hooks, operations };
};

const unread =
  (op: string) =>
  (failure: GitUnreadable | GitRefused | GitAnswerInvalid): OwnGitFailed =>
    failure._tag === 'GitUnreadable'
      ? new OwnGitFailed({ op, message: failure.reason, ran: false, admission: failure.admission })
      : readingFailed(op, failure);

export const placesOf = (git: Git['Service'], checkout: string): Effect.Effect<GitPlaces, OwnGitFailed> =>
  Effect.mapBoth(layoutAt(actingGit(git, 'checkout-places'), checkout, NAMES), {
    onFailure: unread('checkout-places'),
    onSuccess: placesIn,
  });

export const standingOf = (git: Git['Service'], checkout: string): Effect.Effect<Standing, OwnGitFailed> =>
  Effect.mapBoth(standingAt(actingGit(git, 'checkout-standing'), checkout, NAMES), {
    onFailure: unread('checkout-standing'),
    onSuccess: (standing) => ({ places: placesIn(standing.layout), head: standing.head }),
  });

export const pointedAt = (git: Git['Service'], checkout: string): Effect.Effect<Head, OwnGitFailed> =>
  Effect.mapError(headAt(actingGit(git, 'checkout-head'), checkout), unread('checkout-head'));

export const operationIn = (places: GitPlaces): Effect.Effect<OpenOperation | null> =>
  Effect.promise(async () => {
    for (const [index, [, operation]] of OPERATIONS.entries()) {
      const found = await access(places.operations[index] ?? '').then(
        () => true,
        () => false,
      );
      if (found) return operation;
    }
    return null;
  });

export const openOperation = (git: Git['Service'], checkout: string): Effect.Effect<OpenOperation | null, OwnGitFailed> =>
  Effect.flatMap(placesOf(git, checkout), operationIn);

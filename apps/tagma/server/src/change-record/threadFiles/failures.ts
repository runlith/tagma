import { Effect } from 'effect';
import { troubleOf, type GitRefused } from '@runlith/git/repository';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { PathUnreadable } from '../../workspace/contract/service/checkouts.js';
import { isRootFailure } from '../../workspace/contract/wire/roots.js';
import { rootReadRefusal } from '../../workspace/roots/refusal.js';
import type { RootRefusal } from '../../workspace/contract/wire/refusals.js';
import type { ReadingFailure } from '../contract/service/authorship.js';

export const READING_CAPTURE = 4_000_000;

export type AuthorshipRefusalCode = RootRefusal | 'git-unreadable' | 'git-incomplete' | 'path-unread' | 'path-oversized' | 'record-unread';

export const authorshipRefusal = <Code extends string = never>(
  failure: ReadingFailure | GateRefusal<Code>,
): GateRefusal<Code | AuthorshipRefusalCode> => {
  if (failure instanceof GateRefusal) return failure;
  if (isRootFailure(failure)) return rootReadRefusal(failure);
  switch (failure._tag) {
    case 'GitUnreadable':
      return new GateRefusal('git-unreadable', troubleOf(failure), [
        'the reading could not be taken: run the command above yourself to see why',
      ]);
    case 'GitAnswerInvalid':
      return new GateRefusal('git-incomplete', troubleOf(failure), [
        'the answer passed the capture this reading declared: ask about a smaller file',
      ]);
    case 'PathUnreadable':
      return new GateRefusal('path-unread', pathTrouble(failure), ['check what this server may read under the checkout, then ask again']);
    case 'PathRefused':
      return new GateRefusal(
        'path-oversized',
        `${failure.path} holds ${failure.bytes} bytes, past the ${READING_CAPTURE} this reading declares`,
        ['ask about a smaller file'],
      );
  }
  const store: StoreFailure = failure;
  return new GateRefusal('record-unread', `the change record did not answer: ${store._tag}`, ['ask again once the store answers']);
};

const pathTrouble = (failure: PathUnreadable): string =>
  failure.asking === 'probe'
    ? `whether ${failure.path} stands there could not be read: ${failure.cause.reason._tag} — ${failure.cause.message}`
    : `${failure.path} stands there and could not be read: ${failure.cause.reason._tag} — ${failure.cause.message}`;

export const refusedByGit = (failure: GitRefused): Effect.Effect<never, GateRefusal<'git-unreadable'>> =>
  Effect.fail(new GateRefusal('git-unreadable', troubleOf(failure), ['read what git said above and run that command yourself to see why']));

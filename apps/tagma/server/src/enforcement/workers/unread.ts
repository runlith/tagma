import { EnvelopeExceeded } from '@tagma/inspection/node/budget';
import { sliceExceeded } from '@tagma/inspection/node/slices';
import { troubleOf, type GitAnswerInvalid, type GitRefused, type GitUnreadable } from '@runlith/git/repository';
import { Data } from 'effect';
import type { UnreadCause } from './asks.js';

export class Unread extends Data.TaggedError('Unread')<{ readonly cause: UnreadCause; readonly reason: string; readonly split?: true }> {}

export const gitUnread = (error: GitUnreadable | GitRefused | GitAnswerInvalid): Unread =>
  new Unread({ cause: 'git', reason: troubleOf(error) });

export const unreadFrom = (error: unknown): Unread =>
  new Unread({
    cause: error instanceof EnvelopeExceeded ? 'envelope' : 'source',
    reason: error instanceof Error ? error.message : String(error),
    split: sliceExceeded(error) ? true : undefined,
  });

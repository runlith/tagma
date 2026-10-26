import { Effect } from 'effect';
import { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { GitNotAdmitted } from '@runlith/git/Git';
import { troubleOf, type GitAnswerInvalid, type GitRefused, type GitUnreadable } from '@runlith/git/repository';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import { admissionSaid } from '../../platform/git/ownGit.js';
import { type CheckoutEntry, type CheckoutHolder, type CheckoutState, holderKey } from '../../workspace/contract/wire/checkout.js';
import { CHECKOUT_DIRECTORY, inGraphTree } from '../../graph/contract/wire/storage.js';
import type { FinishRefusalRow } from '../contract/wire/failures.js';
import type { LiveThread } from '../contract/service/finishingGate.js';
import { worldFailureRefusal } from '../contract/service/worldRefusals.js';
import { WorktreeFinishRefused, WorktreeUnavailable, type FinishFailure, type FinishReason } from '../contract/wire/failures.js';

type GitFailure = GitUnreadable | GitRefused | GitAnswerInvalid;

export const refused = (reason: FinishReason, message: string, unblock: Unblock): Effect.Effect<never, WorktreeFinishRefused> =>
  Effect.fail(new WorktreeFinishRefused({ reason, message, unblock }));

export const finishNotAdmitted = (admission: GitNotAdmitted): WorktreeFinishRefused =>
  new WorktreeFinishRefused({ reason: 'git-not-admitted', message: admissionSaid(admission), unblock: admission.unblock });

export const gitFailed = (failure: GitFailure): WorktreeFinishRefused => {
  if (failure._tag === 'GitUnreadable' && failure.admission !== undefined) return finishNotAdmitted(failure.admission);
  return new WorktreeFinishRefused({
    reason: failure._tag === 'GitRefused' ? 'git-refused' : failure._tag === 'GitAnswerInvalid' ? 'git-incomplete' : 'git-unreadable',
    message: troubleOf(failure),
    unblock:
      failure._tag === 'GitRefused'
        ? ['read what git said above and clear it, then act again']
        : ['the reading could not be taken: read the command above and run it yourself to see why'],
  });
};

export const asked = <A>(work: Effect.Effect<A, GitFailure>): Effect.Effect<A, WorktreeFinishRefused> => Effect.mapError(work, gitFailed);

export const pathsOf = (reading: CheckoutState, areas: readonly (keyof CheckoutState['entries'])[]): readonly CheckoutEntry[] =>
  areas.flatMap((area) => reading.entries[area].entries);

export const underGraph = (path: string): boolean => path === CHECKOUT_DIRECTORY || path.startsWith(`${CHECKOUT_DIRECTORY}/`);

export const leftBehind = (path: string): boolean => (path.split('/').at(-1) ?? '').startsWith('.merge_file_');

export const ownWork = (path: string): boolean => !leftBehind(path) && !inGraphTree(path);

export const holderName = (holder: CheckoutHolder): string => holder.agentName ?? holderKey(holder.holder);

export const finishRefusalOf = (failure: FinishFailure): FinishRefusalRow => {
  if (failure._tag === 'WorktreeFinishRefused') return { code: failure.reason, message: failure.message, unblock: failure.unblock };
  const refusal = worldFailureRefusal(failure);
  return { code: refusal.code, message: refusal.reason, unblock: refusal.unblock };
};

export const still = (
  reading: CheckoutState,
  reason: 'operation-in-progress' | 'base-mid-operation',
): Effect.Effect<void, WorktreeFinishRefused> =>
  reading.operation === 'none'
    ? Effect.void
    : refused(reason, `a ${reading.operation} is in progress in ${reading.path}`, [
        `the ${reading.operation} ends first, continued or aborted as \`git status\` says (abort_checkout ends it)`,
      ]);

export const stored = <A, E extends { readonly message: string }>(work: Effect.Effect<A, E>): Effect.Effect<A, WorktreeUnavailable> =>
  Effect.mapError(work, (failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message }));

const sectionRefused = (failure: HoldStalled | HoldCut): WorktreeFinishRefused =>
  failure._tag === 'HoldStalled'
    ? new WorktreeFinishRefused({
        reason: 'finishing-busy',
        message: `another finishing act held ${failure.key} for the ${Math.round(failure.waitedMs / 1000)} s this one could wait, so nothing was done`,
        unblock: ['read which act is under way: list_worktrees', 'ask again once it has ended'],
      })
    : new WorktreeFinishRefused({
        reason: 'finishing-cut',
        message: `the act on ${failure.key} ran past its ${Math.round(failure.heldMs / 60_000)}-minute ceiling and was cut: ${failure.leaves}`,
        unblock: [
          'read the worktree and its base as they stand now: list_worktrees, read_checkout',
          'act again once what the cut left is settled',
        ],
      });

const cut = (failure: unknown): failure is HoldStalled | HoldCut => failure instanceof HoldStalled || failure instanceof HoldCut;

export const finishingSection = <A, E, R>(
  entered: Effect.Effect<A, E | HoldStalled | HoldCut, R>,
): Effect.Effect<A, E | WorktreeFinishRefused, R> =>
  Effect.mapError(entered, (failure) => (cut(failure) ? sectionRefused(failure) : failure));

export const runningWords = (busy: readonly LiveThread[]): string =>
  `${busy.map((one) => `${one.threadId} (${one.state === 'idle' ? 'its CLI is up' : one.state})`).join(', ')} still ${busy.length === 1 ? 'runs' : 'run'} in this worktree`;

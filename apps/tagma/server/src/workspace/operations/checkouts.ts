import { Effect, Option } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { holderKey } from '../contract/wire/checkout.js';
import type { ProjectCaller } from '../../projects/contract/wire/project.js';
import {
  type CheckoutWriteFailure,
  type CheckoutCaller,
  CheckoutPlaces,
  CheckoutWrites,
  CommitOverlay,
} from '../contract/service/checkouts.js';
import { gitIdentity } from '../../platform/git/ownGit.js';
import { readCheckout, readCheckoutHistory, readCommit } from './reads.js';
import { HolderLabels } from '../contract/service/checkouts.js';
import { CallerWorkspace } from '../contract/service/places.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CHECKOUT_OPERATIONS as READS } from '../contract/wire/checkoutReads.js';
import { CHECKOUT_ACT_OPERATIONS as ACTS } from '../contract/wire/checkoutActs.js';
import { type CheckoutPlace, checkoutRefusal, placeOf, standing } from './place.js';

const GRAPH_AUTHOR = gitIdentity('tagma').GIT_AUTHOR_EMAIL;

const checkoutCaller = Effect.fn('checkout.caller')(function* (call: ProjectCaller) {
  const place = yield* CallerWorkspace;
  return { projectId: call.project.id, cwd: place?.root } satisfies CheckoutCaller;
});

type Acts = typeof ACTS;

const checkoutAct =
  <K extends keyof Acts>(id: K) =>
  <A, R>(work: Effect.Effect<A, CheckoutWriteFailure, R>) =>
    admitted(ACTS[id])(Effect.mapError(work, checkoutRefusal));

type CheckoutOwners = CheckoutPlaces | CheckoutWrites | CurrentProject | CallerWorkspace | HolderLabels;

export const CHECKOUT_PAIRS = {
  read_checkout: pair(
    READS.read_checkout,
    body(READS.read_checkout, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const { row: checkout, holders: held } = yield* readCheckout(yield* checkoutCaller(call), { root: input.root, base: input.base });
        const threadIds = [
          ...new Set(
            [...held.values()].flatMap((holders) =>
              holders.flatMap((holder) => (holder.holder.kind === 'thread' ? [holder.holder.thread] : [])),
            ),
          ),
        ];
        const listed = (labels: ReadonlyMap<string, readonly { readonly name: string; readonly title: string }[]>) =>
          [...held].map(([path, holders]) => ({
            path,
            holders: holders.map((holder) => ({ ...holder, tasks: labels.get(holderKey(holder.holder)) ?? [] })),
          }));
        if (threadIds.length === 0) return { status: 'ok' as const, checkout, holders: listed(new Map()), taskLabels: 'read' as const };
        const labels = yield* Effect.result((yield* HolderLabels).forHolders(threadIds));
        if (labels._tag === 'Failure')
          return { status: 'ok' as const, checkout, holders: listed(new Map()), taskLabels: 'unavailable' as const };
        return {
          status: 'ok' as const,
          checkout,
          holders: listed(labels.success),
          taskLabels: 'read' as const,
        };
      }),
    }),
  ),

  read_checkout_history: pair(
    READS.read_checkout_history,
    body(READS.read_checkout_history, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const history = yield* readCheckoutHistory(
          yield* checkoutCaller(call),
          { root: input.root, path: input.path, grep: input.grep, limit: input.limit, cursor: input.cursor },
          GRAPH_AUTHOR,
        );
        return { status: 'ok' as const, history };
      }),
    }),
  ),

  read_commit: pair(
    READS.read_commit,
    body(READS.read_commit, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const overlay = Option.getOrUndefined(yield* Effect.serviceOption(CommitOverlay));
        const commit = yield* readCommit(
          yield* checkoutCaller(call),
          { root: input.root, commit: input.commit, thread: input.thread, limit: input.limit, cursor: input.cursor },
          overlay,
        );
        return { status: 'ok' as const, commit };
      }),
    }),
  ),

  stage_checkout: pair(
    ACTS.stage_checkout,
    body<Acts['stage_checkout'], CheckoutPlace, CheckoutOwners>(ACTS.stage_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (input, place: CheckoutPlace) {
        const at = yield* standing(place);
        const acted = yield* checkoutAct('stage_checkout')((yield* CheckoutWrites).stage(at, input.paths));
        return { status: 'ok' as const, ...acted };
      }),
    }),
  ),

  unstage_checkout: pair(
    ACTS.unstage_checkout,
    body<Acts['unstage_checkout'], CheckoutPlace, CheckoutOwners>(ACTS.unstage_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (input, place: CheckoutPlace) {
        const at = yield* standing(place);
        const acted = yield* checkoutAct('unstage_checkout')((yield* CheckoutWrites).unstage(at, input.paths));
        return { status: 'ok' as const, ...acted };
      }),
    }),
  ),

  discard_checkout: pair(
    ACTS.discard_checkout,
    body<Acts['discard_checkout'], CheckoutPlace, CheckoutOwners>(ACTS.discard_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (input, place: CheckoutPlace) {
        const at = yield* standing(place);
        const discarded = yield* checkoutAct('discard_checkout')((yield* CheckoutWrites).discard(at, input.paths));
        return { status: 'ok' as const, ...discarded };
      }),
    }),
  ),

  push_checkout: pair(
    ACTS.push_checkout,
    body<Acts['push_checkout'], CheckoutPlace, CheckoutOwners>(ACTS.push_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (input, place: CheckoutPlace) {
        const at = yield* standing(place);
        const pushed = yield* checkoutAct('push_checkout')((yield* CheckoutWrites).push(at, input));
        return { status: 'ok' as const, ...pushed };
      }),
    }),
  ),

  fetch_checkout: pair(
    ACTS.fetch_checkout,
    body<Acts['fetch_checkout'], CheckoutPlace, CheckoutOwners>(ACTS.fetch_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (_input, place: CheckoutPlace) {
        const at = yield* standing(place);
        const fetched = yield* checkoutAct('fetch_checkout')((yield* CheckoutWrites).fetch(at));
        return { status: 'ok' as const, ...fetched };
      }),
    }),
  ),

  abort_checkout: pair(
    ACTS.abort_checkout,
    body<Acts['abort_checkout'], CheckoutPlace, CheckoutOwners>(ACTS.abort_checkout, {
      prepare: placeOf,
      execute: Effect.fnUntraced(function* (_input, place: CheckoutPlace) {
        const at = yield* standing(place);
        const aborted = yield* checkoutAct('abort_checkout')((yield* CheckoutWrites).abort(at));
        return { status: 'ok' as const, ...aborted };
      }),
    }),
  ),
};

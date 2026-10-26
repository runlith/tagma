import { type Context, Effect } from 'effect';
import type { SessionRef } from '../../platform/contract/wire/session.js';
import { SignedCall, SignedSession } from '../../platform/contract/service/writers.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CurrentGraph, GraphCall, ServedTree } from '../../graph/contract/service/serving.js';
import { CallPlace, CallerAim } from '../../platform/contract/service/place.js';
import type { Place } from '../../platform/contract/wire/place.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { ChangeScope } from '../../change-record/contract/service/scope.js';
import { CallAuthority } from '../../platform/contract/service/authority.js';

export const withAuthority =
  (mode: Context.Service.Shape<typeof CallAuthority>) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, CallAuthority, mode);

export const signedBy =
  (session: SessionRef | null) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, SignedSession, session);

export const signedCall =
  (key: string | null) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, SignedCall, key);

export const forProject =
  (project: CurrentProject['Service']) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentProject>> =>
    Effect.provideService(work, CurrentProject, project);

export const withGraphCall =
  (call: GraphCall['Service']) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, GraphCall>> =>
    Effect.provideService(work, GraphCall, call);

export const onGraph =
  (served: Context.Service.Shape<typeof CurrentGraph>) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, CurrentGraph, served);

export const withServedTree =
  (tree: Context.Service.Shape<typeof ServedTree>) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, ServedTree, tree);

export const withChangeScope =
  (projectId: number) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, ChangeScope>> =>
    Effect.provideService(work, ChangeScope, { projectId: Effect.succeed(projectId) });

export const atPlace =
  (place: Place | null) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, CallPlace, place);

export const aimedAt =
  (aim: Context.Service.Shape<typeof CallerAim>) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(work, CallerAim, aim);

export const inWorkspace =
  (place: CallerWorkspace['Service']) =>
  <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CallerWorkspace>> =>
    Effect.provideService(work, CallerWorkspace, place);

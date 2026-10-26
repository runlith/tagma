import { defected } from '@runlith/activity/Activity';
import { Cause, Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { describeErrors } from '@runlith/utils/error';
import { serverFaultBody } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { refusing } from '../../platform/contract/service/body.js';
import type { GateRefusal, RefusalBody } from '../../platform/contract/wire/refusal.js';

const serverFault = (defect: unknown): HttpServerResponse.HttpServerResponse => {
  return HttpServerResponse.text(JSON.stringify(serverFaultBody(defect)), { status: 500, contentType: 'application/json' });
};

const broke = (defect: unknown) => Effect.logError(`a call broke inside the server: ${describeErrors([defect])}`);

export const answering = <A, R>(work: Effect.Effect<A, GateRefusal | StoreFailure | RefusalBody, R>): Effect.Effect<A, RefusalBody, R> =>
  refusing(work).pipe(
    Effect.catchDefect((defect) =>
      broke(defect).pipe(Effect.andThen(defected(Cause.die(defect), 'server call')), Effect.andThen(Effect.die(serverFault(defect)))),
    ),
  );

export const answeringRecorded = <A, R>(
  work: Effect.Effect<A, GateRefusal | StoreFailure | RefusalBody, R>,
): Effect.Effect<A, RefusalBody, R> =>
  refusing(work).pipe(Effect.catchDefect((defect) => broke(defect).pipe(Effect.andThen(Effect.die(serverFault(defect))))));

export const doorStep =
  (place: string) =>
  <A, R>(work: Effect.Effect<A, GateRefusal | StoreFailure | RefusalBody, R>): Effect.Effect<A, RefusalBody, R> =>
    Effect.tapCause(refusing(work), (cause) => defected(cause, place));

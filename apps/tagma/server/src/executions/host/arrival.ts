import { Duration, Effect, type FileSystem } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { HostRegistration } from '@runlith/executions/HostRegistration';
import { yieldRefusalPath } from '@runlith/executions/protocol/boot';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { HostPlacement, LogicYield } from '../contract/service/host.js';
import { pacedClaim, type StateClaim } from './boot.js';

const LOOKED_EVERY = Duration.millis(100);

export type HostArrival =
  | { readonly _tag: 'Arrived' }
  | { readonly _tag: 'Unheld' }
  | { readonly _tag: 'Refused'; readonly detail: string }
  | { readonly _tag: 'Kept'; readonly detail: string };

export type ArrivalWatch = {
  readonly files: FileSystem.FileSystem;
  readonly registrations: HostRegistration['Service'];
  readonly status: Effect.Effect<RuntimeStatus, ExecutionsFailure>;
  readonly claim: Effect.Effect<StateClaim>;
  readonly ask: LogicYield['Service'];
  readonly state: string;
};

const refusalOf = Effect.fnUntraced(function* (files: FileSystem.FileSystem, state: string) {
  const read = yield* Effect.result(files.readFileString(yieldRefusalPath(state)));
  if (read._tag === 'Failure') {
    if (read.failure.reason._tag !== 'NotFound') {
      yield* Effect.logDebug('the refusal a host logic leaves could not be read', { reason: read.failure.reason._tag });
    }
    return undefined;
  }
  const said = read.success.trim();
  return said.length > 0 ? said : undefined;
});

const unreadable = (failure: ExecutionsFailure): boolean =>
  failure._tag === 'WireUnreadable' || failure._tag === 'WireInvalid' || failure._tag === 'WireFailed';

export const awaitLogic = Effect.fnUntraced(function* (
  watch: ArrivalWatch,
  placed: HostPlacement | undefined,
): Effect.fn.Return<HostArrival> {
  if (placed?._tag !== 'Placed') return { _tag: 'Arrived' };
  const digest = placed.digest;
  let asked: string | undefined;
  let refusing = false;
  const held = pacedClaim(watch.claim);
  for (;;) {
    if ((yield* held)?._tag === 'Free') return { _tag: 'Unheld' };
    if (refusing) {
      const refusal = yield* refusalOf(watch.files, watch.state);
      if (refusal !== undefined) return { _tag: 'Refused', detail: refusal };
    }
    const registered = yield* Effect.result(watch.registrations.read(watch.state));
    if (registered._tag === 'Failure' && registered.failure._tag === 'RegistrationInvalid') {
      return { _tag: 'Kept', detail: `the host registration is not one this server reads: ${registered.failure.detail}` };
    }
    const registration = registered._tag === 'Success' ? registered.success : undefined;
    if (registration?.artifact?.identity.digest === digest) {
      const answered = yield* Effect.result(watch.status);
      if (answered._tag === 'Success' && answered.success.phase === 'open') return { _tag: 'Arrived' };
      if (answered._tag === 'Failure' && unreadable(answered.failure)) {
        return { _tag: 'Kept', detail: `the logic of ${digest} answers what this server cannot read (${answered.failure._tag})` };
      }
    } else if (registration?.artifact !== undefined) {
      const logic = registration.logic;
      if (logic === undefined) {
        return { _tag: 'Kept', detail: `the standing logic of ${registration.artifact.identity.digest} names no witness to ask` };
      }
      const witness = `${logic.pid}@${logic.birth}`;
      if (witness !== asked) {
        const cleared = yield* Effect.result(watch.files.remove(yieldRefusalPath(watch.state), { force: true }));
        if (cleared._tag === 'Success') {
          const told = yield* watch.ask.ask(logic);
          if (told._tag === 'Unasked') return { _tag: 'Kept', detail: told.detail };
          asked = witness;
          refusing = told._tag === 'Asked';
        } else {
          yield* Effect.logDebug('a stale yield refusal could not be cleared; the ask waits for the next look', {
            reason: cleared.failure.message,
          });
        }
      }
    }
    yield* Effect.sleep(LOOKED_EVERY);
  }
});

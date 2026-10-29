import { Duration, Effect, type FileSystem, Schema } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { HostRegistration } from '@runlith/executions/HostRegistration';
import type { Digest } from '@runlith/executions/protocol/artifact';
import { YieldRefusal, yieldRefusalPath } from '@runlith/executions/protocol/boot';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { HostPlacement, LogicYield } from '../contract/service/host.js';
import { logicFell, pacedClaim, type StateClaim } from './boot.js';

const LOOKED_EVERY = Duration.millis(100);

export type HostArrival =
  | { readonly _tag: 'Arrived' }
  | { readonly _tag: 'Unheld' }
  | { readonly _tag: 'Refused'; readonly detail: string }
  | { readonly _tag: 'Fallen'; readonly detail: string }
  | { readonly _tag: 'Kept'; readonly detail: string };

export type ArrivalWatch = {
  readonly files: FileSystem.FileSystem;
  readonly registrations: HostRegistration['Service'];
  readonly status: Effect.Effect<RuntimeStatus, ExecutionsFailure>;
  readonly claim: Effect.Effect<StateClaim>;
  readonly ask: LogicYield['Service'];
  readonly state: string;
};

const readRefusal = Schema.decodeUnknownEffect(Schema.fromJsonString(YieldRefusal));

const refusalOf = Effect.fnUntraced(function* (files: FileSystem.FileSystem, state: string, digest: Digest) {
  const read = yield* Effect.result(files.readFileString(yieldRefusalPath(state)));
  if (read._tag === 'Failure') {
    if (read.failure.reason._tag !== 'NotFound') {
      yield* Effect.logDebug('the refusal a host logic leaves could not be read', { reason: read.failure.reason._tag });
    }
    return undefined;
  }
  const said = read.success.trim();
  if (said.length === 0) return undefined;
  if (!said.startsWith('{')) return { _tag: 'Refused', detail: said } satisfies HostArrival;
  const record = yield* Effect.result(readRefusal(said));
  if (record._tag === 'Failure') {
    return {
      _tag: 'Kept',
      detail: `the standing logic refused in words this server cannot read: ${record.failure.message}`,
    } satisfies HostArrival;
  }
  const { candidate, detail } = record.success;
  return candidate === undefined || candidate === digest
    ? ({ _tag: 'Refused', detail } satisfies HostArrival)
    : ({
        _tag: 'Kept',
        detail: `the standing logic answered for candidate ${candidate}, which this server did not place: ${detail}`,
      } satisfies HostArrival);
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
      const refusal = yield* refusalOf(watch.files, watch.state, digest);
      if (refusal !== undefined) return refusal;
    }
    const registered = yield* Effect.result(watch.registrations.read(watch.state));
    if (registered._tag === 'Failure' && registered.failure._tag === 'RegistrationInvalid') {
      return { _tag: 'Kept', detail: `the host registration is not one this server reads: ${registered.failure.detail}` };
    }
    const registration = registered._tag === 'Success' ? registered.success : undefined;
    const own = registration?.artifact?.identity.digest === digest;
    if (own) {
      const answered = yield* Effect.result(watch.status);
      if (answered._tag === 'Success' && answered.success.phase === 'open') return { _tag: 'Arrived' };
      if (answered._tag === 'Failure' && unreadable(answered.failure)) {
        return { _tag: 'Kept', detail: `the logic of ${digest} answers what this server cannot read (${answered.failure._tag})` };
      }
    }
    const fell = yield* logicFell(watch.files, watch.state, digest);
    if (fell !== undefined) return { _tag: 'Fallen', detail: fell };
    if (!own && registration?.artifact !== undefined) {
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

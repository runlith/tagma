import { Duration, Effect } from 'effect';
import { declare } from '@runlith/held/Held';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { type FileLockFailure, proveHold, withFileLock } from '@runlith/file-lock/FileLock';
import type { CredentialFile } from './CredentialFile.js';
import type { CredentialFileFault } from './failure.js';

export type RefreshStage = 'read' | 'commit';

export type RefreshRequest<Doc, Grant, E, R = never> = {
  readonly grant: (document: Doc, stage: RefreshStage) => Effect.Effect<Grant, E>;
  readonly identity: (grant: Grant) => string;
  readonly needed: (grant: Grant) => Effect.Effect<boolean, E, R>;
  readonly refresh: (grant: Grant) => Effect.Effect<Grant, E, R>;
  readonly validate?: (grant: Grant) => Effect.Effect<void, E, R>;
  readonly replace: (document: Doc, grant: Grant) => Effect.Effect<Doc, E>;
};

export type RefreshLock = {
  readonly path: (key: string) => string;
  readonly waitMs: number;
};

export type RefreshFlightFault = CredentialFileFault | FileLockFailure | HoldCut | HoldStalled;

export type RefreshFlight<Doc> = {
  readonly run: <Grant, E, R = never>(
    key: string,
    request: Effect.Effect<RefreshRequest<Doc, Grant, E, R>, E, R>,
  ) => Effect.Effect<void, E | RefreshFlightFault, R>;
};

export const makeRefreshFlight = <Doc>({
  file,
  name = 'credential-refresh',
  owner = 'credential-file',
  lock,
  span = 'RefreshFlight.refresh',
}: {
  readonly file: CredentialFile<Doc>;
  readonly name?: string;
  readonly owner?: string;
  readonly lock?: RefreshLock;
  readonly span?: string;
}): RefreshFlight<Doc> => {
  const flights = declare<string>({
    name,
    owner,
    rank: 221,
    key: (key) => key,
    concurrency: 1,
    threshold: Duration.seconds(30),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the remote grant may have rotated and the stored row may have changed; read both before retrying',
    },
    external: { named: 'token refresh exchange', callsBack: false },
  });

  return {
    run: <Grant, E, R = never>(key: string, preparing: Effect.Effect<RefreshRequest<Doc, Grant, E, R>, E, R>) => {
      const refresh = Effect.fn(span)(function* (prove: Effect.Effect<void, FileLockFailure>) {
        const request = yield* preparing;
        const found = yield* request.grant(yield* file.readFresh(), 'read');
        if (!(yield* request.needed(found))) return;
        const startedFrom = request.identity(found);
        const renewed = yield* request.refresh(found);
        yield* prove;
        if (request.validate !== undefined) yield* request.validate(renewed);
        yield* file.update((current) =>
          Effect.gen(function* () {
            const held = yield* request.grant(current, 'commit');
            if (request.identity(held) !== startedFrom) return current;
            return yield* request.replace(current, renewed);
          }),
        );
      });

      return flights.hold(
        key,
        lock === undefined ? refresh(Effect.void) : withFileLock(lock.path(key), lock.waitMs, (hold) => refresh(proveHold(hold))),
      );
    },
  };
};

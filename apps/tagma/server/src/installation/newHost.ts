import { Effect, Stream } from 'effect';
import type { MachineHost } from './contract/service/machineHost.js';
import type { NextInstallation } from './contract/service/next.js';
import type { Succession } from './contract/service/succession.js';
import type { PendingRefusal } from './contract/wire/pending.js';
import type { Installation } from './contract/wire/manifest.js';
import type { NewHost } from './contract/wire/newHost.js';
import type { NextFrame, NextIssue } from './contract/wire/next.js';
import type { InstallationCut } from './contract/wire/source.js';

type HostNeed = Omit<NewHost, 'ends'>;

type Moved = { readonly _tag: 'Frame'; readonly frame: NextFrame } | { readonly _tag: 'Moved' };

type Measured = { readonly key: string; readonly newHost: NewHost | undefined };

export const waitingOf = (
  current: Installation | null,
  runs: InstallationCut | null,
  refused: PendingRefusal | null,
): InstallationCut | null => {
  const waits = refused?.waits ?? null;
  const held = waits === null ? null : (refused?.successor ?? null);
  if (held !== null && (current?.manifest.identity.digest ?? null) === waits?.over) return held;
  return current !== null && runs !== null && current.manifest.identity.build !== runs.build
    ? { build: current.manifest.identity.build, digest: current.manifest.identity.digest }
    : null;
};

const needOf = Effect.fnUntraced(function* (
  succession: Succession['Service'],
  machineHost: MachineHost['Service'],
  waiting: InstallationCut | null,
  runs: string | null,
  host: string | null,
  back: string | null,
): Effect.fn.Return<HostNeed | null> {
  const refused = waiting === null ? null : yield* succession.refused;
  const stands = refused !== null && waiting !== null && (refused.successor === null || refused.successor.digest === waiting.digest);
  if (stands) return { cause: 'update', build: waiting.build, host, detail: refused.detail, back: null };
  const stays = yield* machineHost.stays;
  return stays === null ? null : { cause: 'standing', build: runs, host, detail: stays, back };
});

export const newHostOf = Effect.fnUntraced(function* (
  succession: Succession['Service'],
  machineHost: MachineHost['Service'],
  waiting: InstallationCut | null,
  runs: string | null,
  host: string | null,
  back: string | null,
): Effect.fn.Return<NewHost | undefined> {
  const need = yield* needOf(succession, machineHost, waiting, runs, host, back);
  return need === null ? undefined : { ...need, ends: yield* machineHost.endings };
});

export const framesWithNewHost = (input: {
  readonly next: NextInstallation['Service'];
  readonly succession: Succession['Service'];
  readonly machineHost: MachineHost['Service'];
  readonly runs: InstallationCut | null;
}): Stream.Stream<NextFrame, NextIssue> =>
  Stream.unwrap(
    Effect.sync(() => {
      const { next, succession, machineHost, runs } = input;
      let frame: NextFrame | null = null;
      let held: Measured | null = null;
      const latest = () => frame;
      const stamped = Effect.fn('installation.newHost')(function* (moved: Moved) {
        if (moved._tag === 'Frame') frame = moved.frame;
        const standing = latest();
        if (standing === null) return null;
        const current = yield* Effect.matchEffect(succession.current, {
          onFailure: (failure) =>
            Effect.as(
              Effect.logDebug('the standing installation was not read; no update is judged waiting', { reason: failure._tag }),
              null,
            ),
          onSuccess: Effect.succeed,
        });
        const need = yield* needOf(
          succession,
          machineHost,
          waitingOf(current, runs, yield* succession.refused),
          runs?.build ?? null,
          yield* machineHost.build,
          standing.back?.id ?? null,
        );
        const key = need === null ? '' : JSON.stringify(need);
        const kept = held;
        const now: Measured =
          kept !== null && kept.key === key
            ? kept
            : { key, newHost: need === null ? undefined : { ...need, ends: yield* machineHost.endings } };
        held = now;
        if (moved._tag === 'Moved' && now === kept) return null;
        return now.newHost === undefined ? standing : { ...standing, newHost: now.newHost };
      });
      return Stream.merge(
        Stream.map(next.changes, (changed): Moved => ({ _tag: 'Frame', frame: changed })),
        Stream.map(Stream.merge(machineHost.staying, succession.refusals), (): Moved => ({ _tag: 'Moved' })),
      ).pipe(
        Stream.mapEffect(stamped),
        Stream.filter((stamp): stamp is NextFrame => stamp !== null),
      );
    }),
  );

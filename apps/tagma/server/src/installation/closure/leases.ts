import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { directoryLeased, holdDirectory, leaseDirectory, removeUnleased } from '../../platform/lock/directoryLease.js';
import { LockBusy, LockUnavailable, withFileLock } from '@runlith/file-lock/FileLock';
import { Data, Effect } from 'effect';
import { CURRENT, INSTALL_FILE, INSTALL_LOCK } from '../contract/wire/layout.js';
import { attemptHolds } from './attempt.js';
import { claimStaged, releasesNewestFirst, stagedVersions, versionsNewestFirst } from './versions.js';

export class InstallHeld extends Data.TaggedError('InstallHeld')<{
  readonly path: string;
  readonly reason: string;
  readonly busy: boolean;
}> {}

export const withInstallLock = <A, E, R>(
  installRoot: string,
  patienceMs: number,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | InstallHeld, R> =>
  withFileLock(join(installRoot, INSTALL_LOCK), patienceMs, () => work).pipe(
    Effect.mapError((failure) =>
      failure instanceof LockBusy
        ? new InstallHeld({ path: failure.path, reason: `another installation held it for ${failure.waitedMs} ms`, busy: true })
        : failure instanceof LockUnavailable
          ? new InstallHeld({ path: failure.path, reason: failure.reason, busy: false })
          : failure,
    ),
  );

export function holdVersion(version: string): void {
  if (leaseDirectory(version) === 'being-removed') throw new Error(`${version} is being removed by a build; start Tagma from ${CURRENT}`);
}

export function holdingProcess(execPath: string): string | null {
  const version = dirname(realpathSync(execPath));
  return existsSync(join(version, INSTALL_FILE)) ? version : null;
}

export type Claimed = { readonly version: string; readonly root: string; readonly release: () => void };

export function claimLeased(root: string, at: Date): Claimed {
  const version = claimStaged(root, at);
  const held = holdDirectory(join(root, version));
  if (held === null) throw new Error(`${join(root, version)} was taken by a prune as it was made`);
  return { version, root: join(root, version), release: held };
}

export function pruneVersions(root: string, keep: readonly string[]): void {
  const kept = new Set(keep);
  for (const version of versionsNewestFirst(root)) {
    if (kept.has(version)) continue;
    const at = join(root, version);
    if (directoryLeased(at)) continue;
    rmSync(at, { recursive: true, force: true });
  }
}

export function pruneReleases(root: string, keep: readonly string[], forget: (dir: string) => void): void {
  const kept = new Set([...keep, ...attemptHolds(root)]);
  for (const version of [...releasesNewestFirst(root), ...stagedVersions(root)])
    if (!kept.has(version)) removeUnleased(join(root, version), forget);
}

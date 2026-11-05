import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Result } from 'effect';
import { holdDirectory, leaseDirectory } from '../../platform/lock/directoryLease.js';
import { CURRENT } from '../../platform/contract/wire/versions.js';
import { pruneDirectories } from '../../platform/lock/versionLeases.js';
import { currentVersion } from '../../platform/lock/versionedDirectories.js';
import { INSTALL_FILE } from '../contract/wire/layout.js';
import { attemptHolds, stepBackHolds } from './attempt.js';
import { pendingHolds } from './pending.js';
import { claimStaged, releasesNewestFirst, stagedVersions } from './versions.js';

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

export function pruneReleases(root: string, keep: readonly string[], forget: (dir: string) => void): void {
  const standing = currentVersion(root);
  const held = attemptHolds(root);
  if (Result.isFailure(held)) throw held.failure;
  const stepping = stepBackHolds(root);
  if (Result.isFailure(stepping)) throw stepping.failure;
  const kept = new Set([...keep, ...(standing === null ? [] : [standing]), ...held.success, ...stepping.success, ...pendingHolds(root)]);
  pruneDirectories(root, [...releasesNewestFirst(root), ...stagedVersions(root)], kept, forget);
}

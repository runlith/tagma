import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { INSTALL_FILE } from '../contract/wire/layout.js';
import { currentVersion, versionsNewestFirst } from '../../platform/lock/versionedDirectories.js';

export const releasesNewestFirst = (root: string): readonly string[] =>
  versionsNewestFirst(root).filter((version) => existsSync(join(root, version, INSTALL_FILE)));

const STAGED = /^\..+\.incoming$/u;

export const stagedVersions = (root: string): readonly string[] =>
  existsSync(root) ? readdirSync(root).filter((entry) => STAGED.test(entry)) : [];

export const stamped = (at: Date): string => at.toISOString().replace(/[-:.]/g, '');

export function claimStaged(root: string, at: Date): string {
  mkdirSync(root, { recursive: true });
  for (let ordinal = 0; ; ordinal += 1) {
    const candidate = `.${stamped(at)}${ordinal === 0 ? '' : `-${ordinal}`}.incoming`;
    try {
      mkdirSync(join(root, candidate));
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export function publishStaged(root: string, staged: string, at: Date): string {
  for (let ordinal = 0; ; ordinal += 1) {
    const candidate = ordinal === 0 ? stamped(at) : `${stamped(at)}-${ordinal}`;
    if (existsSync(join(root, candidate))) continue;
    renameSync(join(root, staged), join(root, candidate));
    return candidate;
  }
}

export function previousRelease(root: string): string | null {
  const standing = currentVersion(root);
  if (standing === null) return null;
  const versions = releasesNewestFirst(root);
  const at = versions.indexOf(standing);
  return at < 0 ? null : (versions[at + 1] ?? null);
}

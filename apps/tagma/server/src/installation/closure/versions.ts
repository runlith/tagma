import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT, INSTALL_FILE } from '../contract/wire/layout.js';

export function swapCurrent(root: string, version: string): void {
  const current = join(root, CURRENT);
  const pending = `${current}.pending`;
  rmSync(pending, { force: true });
  symlinkSync(version, pending);
  if (existsSync(current) && !lstatSync(current).isSymbolicLink()) rmSync(current, { recursive: true, force: true });
  renameSync(pending, current);
}

export function versionsNewestFirst(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => entry !== CURRENT && !entry.startsWith('.') && lstatSync(join(root, entry)).isDirectory())
    .sort()
    .reverse();
}

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

export function currentVersion(root: string): string | null {
  try {
    return readlinkSync(join(root, CURRENT));
  } catch {
    return null;
  }
}

export function previousRelease(root: string): string | null {
  const standing = currentVersion(root);
  if (standing === null) return null;
  const versions = releasesNewestFirst(root);
  const at = versions.indexOf(standing);
  return at < 0 ? null : (versions[at + 1] ?? null);
}

export function readCurrentFile(root: string, file: string): string | null {
  try {
    return readFileSync(join(root, CURRENT, file), 'utf8');
  } catch {
    return null;
  }
}

export function openVersion(root: string, version: string): string {
  const target = join(root, version);
  mkdirSync(target, { recursive: true });
  return target;
}

export function nextVersion(root: string, at: Date): string {
  const instant = at.toISOString().replace(/[-:.]/g, '');
  let ordinal = 0;
  let candidate = instant;
  while (existsSync(join(root, candidate))) {
    ordinal += 1;
    candidate = `${instant}-${ordinal}`;
  }
  return candidate;
}

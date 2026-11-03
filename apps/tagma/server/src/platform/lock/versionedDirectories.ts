import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT } from '../contract/wire/versions.js';

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

export function currentVersion(root: string): string | null {
  try {
    return readlinkSync(join(root, CURRENT));
  } catch {
    return null;
  }
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

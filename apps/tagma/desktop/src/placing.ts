import { constants, realpathSync } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { BundleRefused, recoverBundle, replaceBundle, verifiedBundle } from '@tagma/server/mac-applications/placement';
import { compareReleases, isRelease } from '@tagma/server/installation/contract/wire/feed';
import { type Bearing, carriedBy } from './release.js';

const SYSTEM_APPLICATIONS = '/Applications';
const REFUSED = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR']);

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(path);
    throw error;
  }
};

export const within = (path: string, root: string): boolean => {
  const [inner, outer] = [real(path), real(root)];
  return inner === outer || inner.startsWith(`${outer}/`);
};

const writable = (directory: string): Promise<boolean> =>
  access(directory, constants.W_OK).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== undefined && REFUSED.has(error.code)) return false;
      throw error;
    },
  );

const userApplications = (home: string): string => join(home, 'Applications');

export const inApplications = (bundle: string, home: string | null): boolean =>
  dirname(bundle) === SYSTEM_APPLICATIONS || (home !== null && dirname(bundle) === userApplications(home));

export type Placed = { readonly placed: string } | { readonly refused: string };

const replaced = async (target: string, kept: string): Promise<Placed> => {
  try {
    await replaceBundle(target, kept, verifiedBundle);
    return { placed: target };
  } catch (error) {
    if (error instanceof BundleRefused) return { refused: error.message };
    throw error;
  }
};

export async function become(own: string | null, kept: string, installRoot: string): Promise<Placed> {
  if (own === null || within(own, installRoot) || !(await writable(dirname(own)))) return { placed: kept };
  return replaced(own, kept);
}

export async function replaceAt(copy: string, kept: string, installRoot: string): Promise<Placed | null> {
  if (within(copy, installRoot) || !(await writable(dirname(copy)))) return null;
  return replaced(copy, kept);
}

export async function keepCopy(own: string, bearing: Bearing, kept: string, installRoot: string): Promise<void> {
  if (within(own, installRoot) || carriedBy(kept)?.digest === bearing.digest) return;
  await replaceBundle(kept, own);
}

export const settleOwn = (own: string): Promise<void> => recoverBundle(own);

export const applicationFolders = (home: string | null): readonly string[] =>
  home === null ? [SYSTEM_APPLICATIONS] : [SYSTEM_APPLICATIONS, userApplications(home)];

const newer = (target: string, build: string): boolean => {
  const there = carriedBy(target)?.build;
  return there !== undefined && isRelease(there) && isRelease(build) && compareReleases(there, build) > 0;
};

export async function moveToApplications(kept: string, build: string, folders: readonly string[]): Promise<Placed> {
  const refusals: string[] = [];
  for (const [at, folder] of folders.entries()) {
    if (at > 0) await mkdir(folder, { recursive: true });
    const target = join(folder, basename(kept));
    if (newer(target, build)) return { refused: `${target} carries a newer release than ${build}` };
    if (!(await writable(folder))) {
      refusals.push(`${folder} is not writable`);
      continue;
    }
    const placed = await replaced(target, kept).catch((error: unknown) => ({ refused: `${target}: ${String(error)}` }));
    if ('placed' in placed) return placed;
    refusals.push(placed.refused);
  }
  return { refused: `no Applications folder took ${basename(kept)}: ${refusals.join('; ')}` };
}

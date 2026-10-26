import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { INSTALL_FILE } from '../contract/wire/layout.js';
import { InstallationManifest } from '../contract/wire/manifest.js';
import { releasesNewestFirst } from './versions.js';

const decodeManifest = Schema.decodeUnknownResult(Schema.fromJsonString(InstallationManifest));

export const absentPath = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export type ManifestReading =
  | { readonly _tag: 'Read'; readonly manifest: InstallationManifest }
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Malformed'; readonly detail: string };

export const manifestAt = (root: string): ManifestReading => {
  let text: string;
  try {
    text = readFileSync(join(root, INSTALL_FILE), 'utf8');
  } catch (error) {
    if (absentPath(error)) return { _tag: 'Absent' };
    throw error;
  }
  const decoded = decodeManifest(text);
  if (decoded._tag === 'Failure') return { _tag: 'Malformed', detail: decoded.failure.message };
  return { _tag: 'Read', manifest: decoded.success };
};

export const releaseAt = (installRoot: string, version: string): InstallationManifest | undefined => {
  const read = manifestAt(join(installRoot, version));
  switch (read._tag) {
    case 'Read':
      return read.manifest;
    case 'Absent':
    case 'Malformed':
      return undefined;
  }
};

export const releaseIdentified = (digest: string, installRoot: string): string | null =>
  releasesNewestFirst(installRoot).find((one) => releaseAt(installRoot, one)?.identity.digest === digest) ?? null;

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { INSTALL_FILE } from '../contract/wire/layout.js';
import { InstallationManifest } from '../contract/wire/manifest.js';
import { releasesNewestFirst } from './versions.js';
import { manifestIssue } from './read.js';
import { makeVersionWindow, type ManifestRevision } from './projection.js';

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

export const manifestRevision = (root: string): ManifestRevision => {
  const resolved = realpathSync(root);
  const path = realpathSync(join(resolved, INSTALL_FILE));
  const info = statSync(path, { bigint: true });
  return { root: resolved, key: `${path}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` };
};

export const makeManifestProjection = () => {
  const versions = makeVersionWindow<ManifestReading>();
  const read = (root: string): ManifestReading => {
    for (;;) {
      let before: ManifestRevision;
      try {
        before = manifestRevision(root);
      } catch (error) {
        if (absentPath(error)) return { _tag: 'Absent' };
        throw error;
      }
      const held = versions.get(before);
      if (held !== undefined) return held;
      const decoded = manifestAt(before.root);
      const issue = decoded._tag === 'Read' ? manifestIssue(decoded.manifest) : undefined;
      const reading: ManifestReading = issue === undefined ? decoded : { _tag: 'Malformed', detail: issue };
      let after: ManifestRevision;
      try {
        after = manifestRevision(root);
      } catch (error) {
        if (absentPath(error)) return { _tag: 'Absent' };
        throw error;
      }
      if (before.root !== after.root || before.key !== after.key) continue;
      versions.set(before, reading);
      return reading;
    }
  };
  const at = (installRoot: string, version: string): InstallationManifest | undefined => {
    const reading = read(join(installRoot, version));
    return reading._tag === 'Read' ? reading.manifest : undefined;
  };
  const identified = (digest: string, installRoot: string): string | null =>
    releasesNewestFirst(installRoot).find((version) => at(installRoot, version)?.identity.digest === digest) ?? null;
  return { read, at, identified };
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

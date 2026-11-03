import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Data, Effect, Schema } from 'effect';
import { removeFile, replaceFile } from '../../platform/durable/files.js';
import { pendingRefusalSchema, type PendingRefusal } from '../contract/wire/pending.js';
import { absentPath, releaseAt } from './manifests.js';
import { currentVersion } from '../../platform/lock/versionedDirectories.js';

const PENDING = 'pending.json';
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(pendingRefusalSchema));
const encode = Schema.encodeSync(Schema.fromJsonString(pendingRefusalSchema));

export class PendingUnreadable extends Data.TaggedError('PendingUnreadable')<{
  readonly path: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.path}: ${this.detail}`;
  }
}

const stored = (installRoot: string): PendingRefusal | null => {
  const path = join(installRoot, PENDING);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    if (absentPath(cause)) return null;
    throw new PendingUnreadable({ path, detail: cause instanceof Error ? cause.message : String(cause) });
  }
  const read = decode(text);
  if (read._tag === 'Failure') throw new PendingUnreadable({ path, detail: read.failure.message });
  return read.success;
};

export const readPending = (installRoot: string): PendingRefusal | null => {
  const pending = stored(installRoot);
  if (pending === null || pending.successor === null || pending.waits === null) return null;
  const standing = currentVersion(installRoot);
  const digest = standing === null ? null : releaseAt(installRoot, standing)?.identity.digest;
  if (digest !== pending.waits.over && digest !== pending.successor.digest) return null;
  const offered = releaseAt(dirname(pending.waits.root), basename(pending.waits.root));
  return offered?.identity.digest === pending.successor.digest ? pending : null;
};

export const writePending = (installRoot: string, pending: PendingRefusal | null) =>
  pending?.waits === null || pending === null
    ? removeFile(join(installRoot, PENDING))
    : Effect.asVoid(replaceFile(join(installRoot, PENDING), encode(pending)));

export const pendingHolds = (installRoot: string): readonly string[] => {
  const pending = readPending(installRoot);
  const root = pending?.waits?.root;
  return root === undefined || dirname(resolve(root)) !== resolve(installRoot) ? [] : [basename(root)];
};

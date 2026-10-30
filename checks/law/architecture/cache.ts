import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Result, Schema } from 'effect';
import { entriesAt } from '../git';
import { revisionAt, saveRevision } from '../declarations/memo';
import type { CouplingIndex } from './coupling';
import { ProgramFinding } from '@tagma/inspection/program';

const index = Schema.Struct({
  revision: Schema.String,
  modules: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      card: Schema.optional(Schema.String),
      paths: Schema.Array(Schema.Struct({ kind: Schema.String, ref: Schema.String })),
    }),
  ),
  packages: Schema.Array(
    Schema.Struct({ name: Schema.String, dir: Schema.String, exports: Schema.optional(Schema.Json), entries: Schema.Array(Schema.String) }),
  ),
  totals: Schema.Record(
    Schema.String,
    Schema.Struct({ path: Schema.String, files: Schema.Int, total: Schema.Int, targets: Schema.Record(Schema.String, Schema.Int) }),
  ),
});
const words = Schema.Struct({ revision: Schema.String, origins: Schema.Record(Schema.String, Schema.Array(Schema.String)) });
type WordIndex = typeof words.Type;
export type WordOrigins = Record<string, readonly string[]>;
const pointer = Schema.Struct({ key: Schema.String });
const pointedAt = (root: string, prefix: string): string | undefined => {
  const decoded = Schema.decodeUnknownResult(pointer)(revisionAt(root, `${prefix}:last`));
  return Result.isFailure(decoded) ? undefined : decoded.success.key;
};
const remember = (root: string, prefix: string, revision: string, value: unknown): void => {
  const key = `${prefix}:${revision}`;
  saveRevision(root, key, value);
  saveRevision(root, `${prefix}:last`, { key });
};
const vendors = Schema.Struct({ revision: Schema.String, words: Schema.Array(Schema.String), findings: Schema.Array(ProgramFinding) });
export type VendorIndex = typeof vendors.Type;

const versions = new Map<string, string>();
export const versionAt = (root: string, revision: string): string => {
  const key = `${root}\0${revision}`;
  const held = versions.get(key);
  if (held !== undefined) return held;
  const hash = createHash('sha256');
  const entries = entriesAt(
    root,
    revision,
    ['checks/law/architecture', 'checks/law/declarations', 'packages/code-facts/src', 'bun.lock'],
    false,
  );
  if (entries.size === 0)
    for (const path of ['cache.ts', 'coupling.ts', 'snapshot.ts', 'strings.ts', 'indexes.ts', 'literals.ts', 'vendors.ts'])
      hash.update(readFileSync(join(import.meta.dir, path)));
  else for (const [path, entry] of entries) hash.update(path).update(entry.object);
  const version = hash.digest('hex');
  versions.set(key, version);
  return version;
};

export const readIndex = (root: string, key: string): CouplingIndex | undefined => {
  const decoded = Schema.decodeUnknownResult(index)(revisionAt(root, key));
  if (Result.isFailure(decoded)) return undefined;
  return { ...decoded.success, packages: decoded.success.packages.map((one) => ({ ...one, exports: one.exports })) };
};

export const lastIndex = (root: string, prefix: string): CouplingIndex | undefined => {
  const key = pointedAt(root, prefix);
  return key === undefined ? undefined : readIndex(root, key);
};

export const saveIndex = (root: string, prefix: string, index: CouplingIndex): void => remember(root, prefix, index.revision, index);

export const readWords = (root: string, key: string): WordIndex | undefined => {
  const decoded = Schema.decodeUnknownResult(words)(revisionAt(root, key));
  return Result.isFailure(decoded) ? undefined : decoded.success;
};
export const lastWords = (root: string, prefix: string): WordIndex | undefined => {
  const key = pointedAt(root, prefix);
  return key === undefined ? undefined : readWords(root, key);
};
export const saveWords = (root: string, prefix: string, words: WordIndex): void => remember(root, prefix, words.revision, words);

export const readVendors = (root: string, key: string): VendorIndex | undefined => {
  const decoded = Schema.decodeUnknownResult(vendors)(revisionAt(root, key));
  return Result.isFailure(decoded) ? undefined : decoded.success;
};
export const lastVendors = (root: string, prefix: string): VendorIndex | undefined => {
  const key = pointedAt(root, prefix);
  return key === undefined ? undefined : readVendors(root, key);
};
export const saveVendors = (root: string, prefix: string, index: VendorIndex): void => remember(root, prefix, index.revision, index);

import type { MemoValue } from '@tagma/inspection/node/memo';
import { Absent, Violation } from '@tagma/inspection/verdict';
import type { ImportSite } from '@runlith/code-facts/imports';
import { createHash } from 'node:crypto';
import { Schema } from 'effect';

export const cacheBudget = (free: number, envelope: number): number => Math.max(0, Math.floor(Math.min(free / 100, envelope * 4)));
export const recordDigest = (key: string, body: string): string => createHash('sha256').update(key).update('\0').update(body).digest('hex');

export function cacheWrites<A>(
  limit = Number.POSITIVE_INFINITY,
  weight: (key: string, value: A | undefined) => number = (key) => Buffer.byteLength(key),
) {
  const pending = new Map<string, A | undefined>();
  let used = 0;
  const set = (key: string, value: A | undefined): void => {
    if (pending.has(key)) used -= weight(key, pending.get(key));
    pending.delete(key);
    const bytes = weight(key, value);
    if (bytes > limit) return;
    pending.set(key, value);
    used += bytes;
    while (used > limit) {
      const oldest = pending.entries().next().value as [string, A | undefined];
      pending.delete(oldest[0]);
      used -= weight(oldest[0], oldest[1]);
    }
  };
  return {
    bytes: (): number => used,
    get: (key: string): A | undefined => pending.get(key),
    touch: (key: string): void => set(key, pending.get(key)),
    set,
    discard: (): void => {
      pending.clear();
      used = 0;
    },
    drain: (): readonly (readonly [string, A | undefined])[] => {
      const writes = [...pending];
      pending.clear();
      used = 0;
      return writes;
    },
  };
}

const site = Schema.Struct({
  specifier: Schema.String,
  line: Schema.Int,
  clause: Schema.Boolean,
  loads: Schema.Literals(['with-module', 'lazily', 'never']),
  forwards: Schema.Boolean,
  form: Schema.optional(Schema.Literals(['import', 'require'])),
  kind: Schema.optional(Schema.Literals(['worker', 'glob', 'unresolved'])),
  patterns: Schema.optional(Schema.Array(Schema.String)),
});
const parse = Schema.Array(site) satisfies Schema.Codec<readonly ImportSite[]>;
const hit = Schema.Struct({
  group: Schema.String,
  origin: Schema.optional(Schema.String),
  suffix: Schema.String,
  distance: Schema.Int,
  chain: Schema.Array(Schema.String),
  file: Schema.String,
  line: Schema.Int,
  specifier: Schema.String,
  message: Schema.optional(Schema.String),
  fix: Schema.optional(Schema.String),
  absent: Schema.optional(Absent),
});
const memo = Schema.Struct({
  dependencies: Schema.Array(Schema.Tuple([Schema.String, Schema.NullOr(Schema.String)])),
  installed: Schema.optional(Schema.Array(Schema.Tuple([Schema.String, Schema.NullOr(Schema.String)]))),
  listings: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  parents: Schema.optional(Schema.Array(Schema.String)),
  violations: Schema.Array(Violation),
  universal: Schema.optional(Schema.Array(Schema.Struct({ key: Schema.String, violation: Violation }))),
  hits: Schema.optional(Schema.Array(hit)),
  started: Schema.optional(Schema.Boolean),
  headroom: Schema.optional(Schema.Finite),
  read: Schema.Array(Schema.String),
}) satisfies Schema.Codec<MemoValue>;

export const CALIBRATION_KEY_PREFIX = 'calibration:';

export const calibrationKeyOf = (builtin: string): string => `${CALIBRATION_KEY_PREFIX}${builtin}`;

export type CalibrationRecord = {
  readonly builtin: string;
  readonly cbMsPerFile: number;
  readonly dbMsPerMib: number;
  readonly probeMs: number;
  readonly probeFiles: number;
  readonly probeMib: number;
  readonly measuredAt: number;
};

const calibration = Schema.Struct({
  builtin: Schema.String,
  cbMsPerFile: Schema.Finite,
  dbMsPerMib: Schema.Finite,
  probeMs: Schema.Finite,
  probeFiles: Schema.Int,
  probeMib: Schema.Finite,
  measuredAt: Schema.Finite,
}) satisfies Schema.Codec<CalibrationRecord>;

export function readCalibrationRecord(key: string, body: string, digest: string): CalibrationRecord | undefined {
  if (!key.startsWith(CALIBRATION_KEY_PREFIX) || digest !== recordDigest(key, body)) return undefined;
  try {
    return Schema.decodeUnknownSync(calibration)(JSON.parse(body) as unknown);
  } catch {
    return undefined;
  }
}

export function writeCalibrationRecord(value: CalibrationRecord): { readonly body: string; readonly digest: string } {
  const key = calibrationKeyOf(value.builtin);
  const body = JSON.stringify(Schema.encodeUnknownSync(calibration)(value));
  return { body, digest: recordDigest(key, body) };
}

export function readCacheRecord(kind: 'parse', key: string, body: string, digest: string): readonly ImportSite[] | undefined;
export function readCacheRecord(kind: 'memo', key: string, body: string, digest: string): MemoValue | undefined;
export function readCacheRecord(
  kind: 'parse' | 'memo',
  key: string,
  body: string,
  digest: string,
): readonly ImportSite[] | MemoValue | undefined {
  if (digest !== recordDigest(key, body)) return undefined;
  try {
    const value: unknown = JSON.parse(body);
    return kind === 'parse' ? Schema.decodeUnknownSync(parse)(value) : Schema.decodeUnknownSync(memo)(value);
  } catch {
    return undefined;
  }
}

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';

export type Working =
  | { readonly kind: 'absent'; readonly key: string }
  | {
      readonly kind: 'file';
      readonly size: number;
      readonly key: string | null;
      readonly mtimeMs: number;
      readonly changedMs: number;
      readonly mode: number;
    }
  | { readonly kind: 'link'; readonly key: string | null; readonly mtimeMs: number; readonly changedMs: number }
  | { readonly kind: 'unread'; readonly cause: string };

export const WorkingStat = Schema.Struct({
  file: Schema.Boolean,
  link: Schema.Boolean,
  size: Schema.Number,
  dev: Schema.String,
  ino: Schema.String,
  mode: Schema.String,
  mtime: Schema.String,
  ctime: Schema.String,
  changedAt: Schema.Number,
});

export type WorkingStat = typeof WorkingStat.Type;

const SETTLED_MS = 2000;

const NS_PER_MS = 1_000_000;

const ABSENT: Working = { kind: 'absent', key: 'absent' };

export const workingOf = (info: WorkingStat, now: number): Working => {
  if (!info.file && !info.link) return { kind: 'unread', cause: 'neither a regular file nor a symlink' };
  const key = now - info.changedAt > SETTLED_MS ? `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtime}:${info.ctime}` : null;
  const mtimeMs = Number(info.mtime) / NS_PER_MS;
  const changedMs = Number(info.ctime) / NS_PER_MS;
  return info.link
    ? { kind: 'link', key, mtimeMs, changedMs }
    : { kind: 'file', size: info.size, key, mtimeMs, changedMs, mode: Number(info.mode) };
};

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

const missing = (cause: unknown): boolean => codeOf(cause) === 'ENOENT' || codeOf(cause) === 'ENOTDIR';

const causeOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

type Failed = { readonly kind: 'absent' } | { readonly kind: 'unread'; readonly cause: string };

const failed = (cause: unknown): Failed => (missing(cause) ? { kind: 'absent' } : { kind: 'unread', cause: causeOf(cause) });

class Names {
  #normal: ReadonlySet<string> | null = null;
  constructor(readonly exact: ReadonlySet<string>) {}
  normal(): ReadonlySet<string> {
    this.#normal ??= new Set([...this.exact].map((name) => name.normalize('NFC')));
    return this.#normal;
  }
}

type Listed = Names | 'absent' | { readonly unread: string };

export type Listing = { readonly root: string; readonly listed: (dir: string) => Promise<Listed> };

export type Standing = 'stands' | 'absent' | { readonly unread: string };

export const listingUnder = (root: string): Listing => {
  const listings = new Map<string, Promise<Listed>>();
  return {
    root,
    listed: (dir) => {
      const held = listings.get(dir);
      if (held !== undefined) return held;
      const names = readdir(join(root, dir)).then(
        (entries): Listed => new Names(new Set(entries)),
        (cause): Listed => (missing(cause) ? 'absent' : { unread: causeOf(cause) }),
      );
      listings.set(dir, names);
      return names;
    },
  };
};

const standingOf = async (path: string, listing: Listing): Promise<Standing> => {
  let dir = '';
  let equivalent = false;
  for (const part of path.split('/')) {
    const names = await listing.listed(dir);
    if (names === 'absent') return 'absent';
    if (!(names instanceof Names)) return names;
    if (!names.exact.has(part)) {
      if (!names.normal().has(part.normalize('NFC'))) return 'absent';
      equivalent = true;
    }
    dir = dir === '' ? part : `${dir}/${part}`;
  }
  if (!equivalent) return 'stands';
  return lstat(join(listing.root, path)).then(
    (): Standing => 'stands',
    (cause): Standing => (missing(cause) ? 'absent' : { unread: causeOf(cause) }),
  );
};

export const standing = (path: string, listing: Listing): Effect.Effect<Standing> => Effect.promise(() => standingOf(path, listing));

export const workingAt = (path: string, now: number): Effect.Effect<Working> =>
  Effect.map(Effect.result(Effect.tryPromise({ try: () => lstat(path, { bigint: true }), catch: failed })), (read): Working => {
    if (read._tag === 'Failure') return read.failure.kind === 'absent' ? ABSENT : read.failure;
    const info = read.success;
    return workingOf(
      {
        file: info.isFile(),
        link: info.isSymbolicLink(),
        size: Number(info.size),
        dev: String(info.dev),
        ino: String(info.ino),
        mode: String(info.mode),
        mtime: String(info.mtimeNs),
        ctime: String(info.ctimeNs),
        changedAt: Number(info.ctimeMs),
      },
      now,
    );
  });

export const exactWorkingAt = (listing: Listing, spelled: string, now: number): Effect.Effect<Working> =>
  Effect.flatMap(workingAt(join(listing.root, spelled), now), (working) =>
    working.kind === 'file' || working.kind === 'link'
      ? Effect.map(standing(spelled, listing), (stood): Working =>
          stood === 'stands' ? working : stood === 'absent' ? ABSENT : { kind: 'unread', cause: stood.unread },
        )
      : Effect.succeed(working),
  );

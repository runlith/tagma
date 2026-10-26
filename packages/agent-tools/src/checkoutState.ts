import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { Clock, Data, Effect, FileSystem } from 'effect';
import type { workingAt, Working } from '@runlith/files/working';
import { Git } from '@runlith/git/Git';
import { contentDigest, streamedDigest } from '@runlith/files/content';
import { isStagingFile } from '@runlith/files/replace';
import type { Heard } from './changeSource';
import type { ResolvedToolOptions } from './workspace';
import { within } from './workspace/paths';

export type Head = { readonly commit: string | null } | { readonly unread: string };

export type Seen = {
  readonly mtimeMs: number | null;
  readonly changedMs: number | null;
  readonly mode: number | null;
  readonly link: boolean;
  readonly bytes: Uint8Array | null;
};

export type Measured = {
  readonly state: Map<string, string>;
  readonly presence: ReadonlyMap<string, boolean | null>;
  readonly seen: ReadonlyMap<string, Seen>;
  readonly heard: ReadonlyMap<string, Heard>;
  readonly head: Head;
  readonly startedAt: number;
  readonly endedAt: number;
};

export type Reading = Measured | { readonly unreadable: string };

export const readable = (reading: Reading | null): Map<string, string> | null =>
  reading !== null && 'state' in reading ? reading.state : null;

export const unkept = (reading: Reading): Reading =>
  'unreadable' in reading
    ? reading
    : { ...reading, seen: new Map([...reading.seen].map(([name, seen]) => [name, seen.bytes === null ? seen : { ...seen, bytes: null }])) };

export function placeOf(root: string, name: string): { name: string; place: string } | null {
  const place = path.resolve(root, name);
  const relative = path.relative(root, place);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return { name: relative, place };
}

export const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export type Listing = { readonly names: Set<string>; readonly untracked: readonly string[] };

const TRANSIENT = /^(?:\.merge_file_[A-Za-z0-9]{6}|\.watch-cookie-\d+-\d+)$/;

export function porcelainListing(listing: string): Listing | null {
  if (listing !== '' && !listing.includes('\0')) return null;
  const fields = listing.split('\0');
  const names = new Set<string>();
  const untracked: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index] ?? '';
    if (record.length < 4) continue;
    const name = record.slice(3);
    if (record.startsWith('??') && !name.endsWith('/') && (TRANSIENT.test(name) || isStagingFile(name))) continue;
    if (!name.endsWith('/')) names.add(name);
    else if (record.startsWith('??')) untracked.push(name);
    if (record[0] === 'R' || record[0] === 'C' || record[1] === 'R' || record[1] === 'C') {
      const origin = fields[index + 1];
      if (origin !== undefined && origin !== '') names.add(origin);
      index += 1;
    }
  }
  return { names, untracked };
}

const PATHSPEC_CHARS = 16 * 1024;

export const topLiteral = (name: string): string => `:(top,literal)${name}`;

const UNMONITORED = ['-c', 'core.fsmonitor=false'];

const specBatches = (names: readonly string[]): readonly (readonly string[])[] => {
  const batches: string[][] = [];
  let chars = PATHSPEC_CHARS;
  for (const name of names) {
    const spec = topLiteral(name);
    if (chars >= PATHSPEC_CHARS) {
      batches.push([]);
      chars = 0;
    }
    (batches[batches.length - 1] as string[]).push(spec);
    chars += spec.length;
  }
  return batches;
};

const statusListing = Effect.fn('CheckoutBaselines.statusListing')(function* (
  workdir: string,
  specs: readonly string[] | null,
): Effect.fn.Return<Listing | { readonly unreadable: string }, never, Git> {
  const ran = yield* (yield* Git)
    .run(
      [
        ...(specs === null ? [] : UNMONITORED),
        '--no-optional-locks',
        'status',
        '--porcelain',
        '-z',
        '-unormal',
        ...(specs === null ? [] : ['--', ...specs]),
      ],
      { cwd: workdir },
    )
    .pipe(Effect.result);
  if (ran._tag === 'Failure') return { unreadable: `git could not be run: ${quoted(messageOf(ran.failure))}` };
  const measured = ran.success;
  if (measured.status !== 0) return { unreadable: `git said: ${quoted(gitSaid(measured.stderr, measured.status))}` };
  if (measured.overflow || measured.messageOverflow) return { unreadable: 'git answered an incomplete checkout listing' };
  return porcelainListing(measured.stdout) ?? { unreadable: 'git answered a listing this reader cannot frame' };
});

const untrackedWithin = Effect.fn('CheckoutBaselines.untrackedWithin')(function* (
  workdir: string,
  directories: readonly string[],
): Effect.fn.Return<readonly string[] | { readonly unreadable: string }, never, Git> {
  const git = yield* Git;
  const names: string[] = [];
  for (const batch of specBatches(directories)) {
    const ran = yield* git
      .run([...UNMONITORED, 'ls-files', '-z', '--others', '--exclude-standard', '--full-name', '--', ...batch], { cwd: workdir })
      .pipe(Effect.result);
    if (ran._tag === 'Failure') return { unreadable: `git could not be run: ${quoted(messageOf(ran.failure))}` };
    const listed = ran.success;
    if (listed.status !== 0) return { unreadable: `git said: ${quoted(gitSaid(listed.stderr, listed.status))}` };
    if (listed.overflow || listed.messageOverflow) return { unreadable: 'git answered an incomplete listing of untracked directories' };
    for (const name of listed.stdout.split('\0')) if (name !== '' && !name.endsWith('/') && !isStagingFile(name)) names.push(name);
  }
  return names;
});

export const HASH_BYTES = 16 * 1024 * 1024;

const KEPT_BYTES = 8 * 1024 * 1024;

const KEPT_FILE_BYTES = 256 * 1024;

type Budget = { left: number };

type FileReading = { readonly digest: string; readonly present: boolean | null; readonly bytes: Uint8Array | null };

const hashed = (bytes: Uint8Array): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 16);

const unreadFile: FileReading = { digest: contentDigest(''), present: null, bytes: null };

const kept = (budget: Budget, bytes: Uint8Array): Uint8Array | null => {
  if (bytes.byteLength > KEPT_FILE_BYTES || bytes.byteLength > budget.left) return null;
  budget.left -= bytes.byteLength;
  return bytes;
};

const LARGE_KEPT = 256;

const largeDigests = new Map<string, { readonly stamp: string; readonly digest: string }>();

type Stamp = { readonly _tag: 'stamped'; readonly stamp: string; readonly racy: boolean } | { readonly _tag: 'unstamped' };

class StampUnread extends Data.TaggedError('StampUnread')<{ readonly message: string }> {}

const stampOf = Effect.fn('CheckoutBaselines.stampOf')(function* (place: string): Effect.fn.Return<Stamp> {
  const read = yield* Effect.result(
    Effect.tryPromise({ try: () => stat(place), catch: (cause) => new StampUnread({ message: messageOf(cause) }) }),
  );
  if (read._tag === 'Failure') {
    yield* Effect.logWarning('The file cache stamp could not be read', { place, reason: read.failure.message });
    return { _tag: 'unstamped' };
  }
  const info = read.success;
  const mtime = info.mtimeMs;
  const ctime = info.ctimeMs;
  const measured = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  return {
    _tag: 'stamped',
    stamp: `${info.size}:${mtime}:${ctime}:${info.ino}:${info.dev}`,
    racy: Math.floor(mtime / 1000) >= measured || Math.floor(ctime / 1000) >= measured,
  };
});

const largeDigest = Effect.fn('CheckoutBaselines.largeDigest')(function* (fs: FileSystem.FileSystem, place: string) {
  const stamped = yield* stampOf(place);
  const known = largeDigests.get(place);
  if (stamped._tag === 'stamped' && known !== undefined && known.stamp === stamped.stamp) return known.digest;
  const streamed = yield* Effect.result(streamedDigest(fs, place));
  if (streamed._tag === 'Failure') {
    yield* Effect.logWarning('The large file digest could not be read', { place, reason: streamed.failure.message });
    return null;
  }
  largeDigests.delete(place);
  if (stamped._tag === 'stamped' && !stamped.racy) {
    if (largeDigests.size >= LARGE_KEPT) largeDigests.delete(largeDigests.keys().next().value as string);
    largeDigests.set(place, { stamp: stamped.stamp, digest: streamed.success });
  }
  return streamed.success;
});

const digestReading = Effect.fn('CheckoutBaselines.digestReading')(function* (
  fs: FileSystem.FileSystem,
  place: string,
  budget: Budget,
): Effect.fn.Return<FileReading> {
  const info = yield* fs.stat(place).pipe(Effect.result);
  if (info._tag === 'Failure') {
    if (info.failure.reason._tag === 'NotFound') return { digest: contentDigest(''), present: false, bytes: null };
    yield* Effect.logWarning('The file snapshot could not be statted', { place, reason: info.failure.message });
    return unreadFile;
  }
  const size = Number(info.success.size);
  if (size > HASH_BYTES) {
    const digest = yield* largeDigest(fs, place);
    return digest === null ? unreadFile : { digest, present: true, bytes: null };
  }
  const bytes = yield* fs.readFile(place).pipe(Effect.result);
  if (bytes._tag === 'Failure') {
    yield* Effect.logWarning('The file snapshot could not be read', { place, reason: bytes.failure.message });
    return unreadFile;
  }
  return { digest: hashed(bytes.success), present: true, bytes: kept(budget, bytes.success) };
});

const linkReading = Effect.fn('CheckoutBaselines.linkReading')(function* (
  fs: FileSystem.FileSystem,
  place: string,
  budget: Budget,
): Effect.fn.Return<FileReading> {
  const target = yield* fs.readLink(place).pipe(Effect.result);
  if (target._tag === 'Failure') {
    if (target.failure.reason._tag === 'NotFound') return { digest: contentDigest(''), present: false, bytes: null };
    yield* Effect.logWarning('The link snapshot could not be read', { place, reason: target.failure.message });
    return unreadFile;
  }
  const bytes = new TextEncoder().encode(target.success);
  return { digest: hashed(bytes), present: true, bytes: kept(budget, bytes) };
});

export const readingNow = Effect.fn('CheckoutBaselines.readingNow')(function* (
  fs: FileSystem.FileSystem,
  place: string,
  working: typeof workingAt | undefined,
): Effect.fn.Return<{ readonly digest: string; readonly present: boolean | null; readonly seen: Seen | null }> {
  const budget: Budget = { left: KEPT_FILE_BYTES };
  const target = yield* fs.readLink(place).pipe(Effect.option);
  const read = target._tag === 'Some' ? yield* linkReading(fs, place, budget) : yield* digestReading(fs, place, budget);
  if (read.present !== true) return { digest: read.digest, present: read.present, seen: null };
  const after = working === undefined ? null : yield* working(place, yield* Clock.currentTimeMillis);
  return { digest: read.digest, present: true, seen: { ...stamped(after), link: target._tag === 'Some', bytes: read.bytes } };
});

export type StateReading =
  | {
      readonly state: Map<string, string>;
      readonly presence: Map<string, boolean | null>;
      readonly seen: Map<string, Seen>;
    }
  | { readonly unreadable: string };

export const checkoutState = Effect.fn('CheckoutBaselines.checkoutState')(function* (
  workdir: string,
  resolved: ResolvedToolOptions,
  frontier: CheckoutFrontier,
  scope: readonly string[] | null,
  confirmed: readonly string[] = [],
): Effect.fn.Return<StateReading, never, FileSystem.FileSystem | Git> {
  const listing = yield* statusListing(workdir, scope === null ? null : scope.map(topLiteral));
  if ('unreadable' in listing) return listing;
  const names = listing.names;
  const untracked = new Set(listing.untracked);
  if (scope === null)
    for (const specs of specBatches(confirmed)) {
      const named = yield* statusListing(workdir, specs);
      if ('unreadable' in named) return named;
      for (const name of named.names) names.add(name);
      for (const name of named.untracked) untracked.add(name);
    }
  const fs = yield* FileSystem.FileSystem;
  const unowned = within(resolved.unowned, resolved.cwd);
  const owned = [...untracked].filter((name) => {
    const directory = placeOf(resolved.cwd, name);
    return directory !== null && !unowned(directory.name);
  });
  const expanded = yield* untrackedWithin(workdir, owned);
  if ('unreadable' in expanded) return expanded;
  for (const name of expanded) names.add(name);
  const state = new Map<string, string>();
  const presence = new Map<string, boolean | null>();
  const seen = new Map<string, Seen>();
  const budget: Budget = { left: KEPT_BYTES };
  yield* Effect.forEach(
    names,
    (name): Effect.Effect<void> =>
      Effect.gen(function* () {
        const file = placeOf(resolved.cwd, name);
        if (file === null || unowned(file.name)) return;
        const read = yield* frontier.read(fs, file.place, resolved.world.working, budget);
        state.set(name, read.digest);
        presence.set(name, read.present);
        if (read.seen !== null) seen.set(name, read.seen);
      }),
    { concurrency: 3, discard: true },
  );
  return { state, presence, seen };
});

export function movedPaths(before: Reading | null, after: Reading | null): readonly string[] {
  if (before === null || after === null || 'unreadable' in before || 'unreadable' in after) return [];
  const moved: string[] = [];
  for (const [name, digest] of after.state) {
    if (
      before.presence.get(name) === null ||
      after.presence.get(name) === null ||
      before.state.get(name) !== digest ||
      before.presence.get(name) !== after.presence.get(name)
    )
      moved.push(name);
  }
  for (const name of before.state.keys()) if (!after.state.has(name)) moved.push(name);
  return moved.sort();
}

type FileEvidence = {
  readonly key: string;
  readonly digest: string;
  readonly mtimeMs: number | null;
  readonly changedMs: number | null;
  readonly mode: number | null;
  readonly link: boolean;
};

type FrontierReading = { readonly digest: string; readonly present: boolean | null; readonly seen: Seen | null };

type Stamped = Pick<Seen, 'mtimeMs' | 'changedMs' | 'mode'>;

const stamped = (working: Working | null): Stamped =>
  working === null || (working.kind !== 'file' && working.kind !== 'link')
    ? { mtimeMs: null, changedMs: null, mode: null }
    : { mtimeMs: working.mtimeMs, changedMs: working.changedMs, mode: working.kind === 'file' ? working.mode : null };

export class CheckoutFrontier {
  private inputs = new Map<string, FileEvidence>();
  private reading = new Map<string, FileEvidence>();
  public generation = 0;

  readonly begin = (): void => {
    this.reading = new Map();
  };

  readonly keep = (): void => {
    for (const [place, evidence] of this.inputs) if (!this.reading.has(place)) this.reading.set(place, evidence);
  };

  readonly end = (): void => {
    this.inputs = this.reading;
  };

  readonly lost = (): void => {
    this.inputs = new Map();
    this.reading = new Map();
    this.generation += 1;
  };

  readonly read = Effect.fn('CheckoutFrontier.read')(function* (
    this: CheckoutFrontier,
    fs: FileSystem.FileSystem,
    place: string,
    working: typeof workingAt | undefined,
    budget: Budget,
  ): Effect.fn.Return<FrontierReading> {
    const before: Working =
      working === undefined ? { kind: 'unread', cause: 'no stat reader' } : yield* working(place, yield* Clock.currentTimeMillis);
    const key = before.kind === 'unread' ? null : before.key;
    const held = this.inputs.get(place);
    if (key !== null && held?.key === key) {
      this.reading.set(place, held);
      return {
        digest: held.digest,
        present: before.kind !== 'absent',
        seen:
          before.kind === 'absent'
            ? null
            : { mtimeMs: held.mtimeMs, changedMs: held.changedMs, mode: held.mode, link: held.link, bytes: null },
      };
    }
    const link = before.kind === 'link';
    const read = link ? yield* linkReading(fs, place, budget) : yield* digestReading(fs, place, budget);
    if (read.present === null) {
      this.inputs.delete(place);
      return { digest: read.digest, present: null, seen: null };
    }
    const after = working === undefined ? null : yield* working(place, yield* Clock.currentTimeMillis);
    const stamp = stamped(after);
    if (key !== null && after !== null && after.kind !== 'unread' && after.key === key) {
      this.reading.set(place, { key, digest: read.digest, ...stamp, link });
    }
    return { digest: read.digest, present: read.present, seen: read.present ? { ...stamp, link, bytes: read.bytes } : null };
  });
}

export function gitSaid(said: string, code: number): string {
  const lines = said
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.find((line) => /^(fatal|error):/i.test(line)) ?? lines[0] ?? `git status exited ${code}`;
}

export const quoted = (value: string): string => JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);

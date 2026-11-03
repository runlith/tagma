import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { ApplicationNotCopied, type Applications } from '../installation/contract/service/applications.js';
import { RUNTIME_PART } from '../installation/contract/wire/layout.js';
import { DESKTOP } from '../installation/contract/wire/manifest.js';
import { hostBundle, RELEASE_INSIDE } from './bundle.js';
import { currentVersion } from '../platform/lock/versionedDirectories.js';
import { answered, refusalOf } from '../platform/command.js';
import { cloneTree } from '../platform/durable/clone.js';

const CODESIGN = '/usr/bin/codesign';
const XATTR = '/usr/bin/xattr';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const QUARANTINE = 'com.apple.quarantine';

const BUNDLE = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/u;

export const bundleOf = (executable: string): string | null => BUNDLE.exec(executable)?.[1] ?? null;

const carriedRelease = (bundle: string): string => join(bundle, RELEASE_INSIDE);

export const carrierOf = (dir: string): string | null => {
  const suffix = `/${RELEASE_INSIDE}`;
  const bundle = dir.endsWith(suffix) ? dir.slice(0, -suffix.length) : null;
  return bundle !== null && bundle.endsWith('.app') ? bundle : null;
};

const keptApplication = (root: string): string | undefined => {
  const kept = join(root, DESKTOP);
  if (!existsSync(kept)) return undefined;
  const found = readdirSync(kept).filter((name) => name.endsWith('.app'));
  return found.length === 1 ? join(kept, found[0]!) : undefined;
};

export class BundleRefused extends Data.TaggedError('BundleRefused')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

const notCopied = (path: string) => (cause: unknown) =>
  new ApplicationNotCopied({ path, reason: cause instanceof Error ? cause.message : String(cause) });

const attempt = (path: string, work: () => Promise<unknown>): Effect.Effect<void, ApplicationNotCopied> =>
  Effect.asVoid(Effect.tryPromise({ try: work, catch: notCopied(path) }));

const beside = (target: string, part: 'incoming' | 'outgoing'): string => join(dirname(target), `.${basename(target)}.${part}`);

const removed = (path: string): Effect.Effect<void, ApplicationNotCopied> =>
  attempt(path, () => rm(path, { recursive: true, force: true }));

export const recoverBundle = Effect.fn('macApplications.recoverBundle')(function* (target: string) {
  const outgoing = beside(target, 'outgoing');
  if (!existsSync(target) && existsSync(outgoing)) yield* attempt(target, () => rename(outgoing, target));
  yield* removed(beside(target, 'incoming'));
  yield* removed(outgoing);
});

const EXCHANGE = `const { dlopen, ptr, read } = require('bun:ffi');
const libc = dlopen('libc.dylib', {
  renamex_np: { args: ['ptr', 'ptr', 'u32'], returns: 'i32' },
  __error: { args: [], returns: 'ptr' },
});
const from = Buffer.from(process.argv[1] + '\\0');
const to = Buffer.from(process.argv[2] + '\\0');
if (libc.symbols.renamex_np(ptr(from), ptr(to), 2) !== 0) {
  throw new Error('atomic application exchange failed: errno ' + read.i32(libc.symbols.__error(), 0));
}`;

const staged = Effect.fnUntraced(function* (target: string, from: string) {
  yield* attempt(target, () => mkdir(dirname(target), { recursive: true }));
  yield* recoverBundle(target);
  const incoming = beside(target, 'incoming');
  yield* cloneTree(from, incoming).pipe(
    Effect.mapError((failure) => new ApplicationNotCopied({ path: incoming, reason: failure.reason, needed: failure.needed })),
    Effect.onError(() =>
      removed(incoming).pipe(
        Effect.catchTag('ApplicationNotCopied', (left) =>
          Effect.logWarning(`${left.path} stays after a failed copy, and the next placement removes it: ${left.reason}`),
        ),
      ),
    ),
  );
  return incoming;
});

const swapped = Effect.fnUntraced(function* (target: string, from: string, incoming: string) {
  if (existsSync(target)) {
    const runtime = join(from, RELEASE_INSIDE, RUNTIME_PART);
    const refusal = refusalOf(runtime, yield* answered(runtime, ['-e', EXCHANGE, incoming, target]));
    if (refusal !== null) return yield* new ApplicationNotCopied({ path: target, reason: `the application exchange failed: ${refusal}` });
  } else yield* attempt(target, () => rename(incoming, target));
  yield* removed(incoming);
});

export const replaceBundle = Effect.fn('macApplications.replace')(function* (
  target: string,
  from: string,
  verify: (bundle: string) => Effect.Effect<string | null>,
) {
  const incoming = yield* staged(target, from);
  const refused = yield* verify(incoming);
  if (refused !== null) {
    yield* removed(incoming);
    return yield* new BundleRefused({ reason: refused });
  }
  yield* swapped(target, from, incoming);
});

const copyBundle = Effect.fn('macApplications.copy')(function* (from: string, to: string) {
  yield* swapped(to, from, yield* staged(to, from));
});

export const carriedIn = (dir: string): string | null => {
  const bundles = readdirSync(dir).filter((name) => name.endsWith('.app'));
  return bundles.length === 1 ? carriedRelease(join(dir, bundles[0]!)) : null;
};

const bundlesUnder = (dir: string): string[] => {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.endsWith('.framework')) continue;
      const path = join(at, entry.name);
      if (entry.name.endsWith('.app')) found.push(path);
      walk(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
};

export const forgetBundles = (dir: string): void => {
  const bundles = bundlesUnder(dir);
  if (bundles.length === 0) return;
  const ran = spawnSync(LSREGISTER, ['-u', ...bundles], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  const refusals = [...(ran.stderr ?? '').matchAll(/: (-\d+)/gu)].map((match) => match[1]);
  //! -10814 is kLSApplicationNotFoundErr: a bundle never launched has no record to forget
  if (ran.status !== 0 && (refusals.length === 0 || refusals.some((code) => code !== '-10814'))) {
    throw new Error(
      `LaunchServices kept ${bundles.length} applications of ${dir}: ${ran.stderr?.trim() || ran.error?.message || `lsregister exited ${ran.status}`}`,
    );
  }
};

const requirementOf = (bundle: string): Effect.Effect<{ readonly said: string } | { readonly requirement: string }> =>
  Effect.map(answered(CODESIGN, ['-d', '-r-', bundle]), (read) => {
    const requirement = /designated => (.+)/u.exec(read.text)?.[1]?.trim();
    return read.status === 0 && requirement !== undefined ? { requirement } : { said: refusalOf(CODESIGN, read) ?? read.text.trim() };
  });

export const verifiedBundle = (bundle: string): Effect.Effect<string | null> =>
  Effect.map(answered(CODESIGN, ['--verify', '--deep', '--strict', bundle]), (verified) => {
    const refusal = refusalOf(CODESIGN, verified);
    return refusal === null ? null : `${bundle} carries no valid signature: ${refusal}`;
  });

const unquarantined = (path: string): Effect.Effect<string | null> =>
  Effect.map(answered(XATTR, ['-dr', QUARANTINE, path]), (answer) => refusalOf(XATTR, answer));

export const signatureRefusal = Effect.fn('macApplications.signature')(function* (carried: string, installRoot: string) {
  const bundle = carrierOf(carried);
  if (bundle === null) return `${carried} is carried by no application`;
  const unsigned = yield* verifiedBundle(bundle);
  if (unsigned !== null) return unsigned;
  const standing = currentVersion(installRoot);
  const running = standing === null ? undefined : keptApplication(join(installRoot, standing));
  if (running === undefined || !existsSync(running)) return null;
  const [offered, ours] = yield* Effect.all([requirementOf(bundle), requirementOf(running)], { concurrency: 2 });
  if ('said' in offered) return `the signature of ${bundle} could not be read: ${offered.said}`;
  if ('said' in ours) return `the signature of ${running} could not be read: ${ours.said}`;
  return offered.requirement === ours.requirement
    ? null
    : `${bundle} is signed as ${offered.requirement}, and the application that stands here as ${ours.requirement}`;
});

export const applications: Applications = {
  kept: (root, name) => join(root, DESKTOP, hostBundle(name)),
  inside: carriedRelease,
  carrier: carrierOf,
  carried: carriedIn,
  verify: verifiedBundle,
  copy: copyBundle,
  unquarantine: unquarantined,
  forget: forgetBundles,
  signature: signatureRefusal,
};

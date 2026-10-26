import { existsSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import { digestOf } from '@runlith/executions/hostArtifacts';
import type { Digest } from '@runlith/executions/protocol/artifact';
import { INSTALL_FILE } from '../contract/wire/layout.js';
import {
  type InstallationFailure,
  InstallationInvalid,
  InstallationManifest,
  InstallationMissing,
  type InstallationPart,
  type InstallationPlatform,
  type InstallationRole,
  InstallationUnreadable,
  ACTIVITY_MIGRATIONS,
  DESKTOP,
  MIGRATIONS,
  REQUIRED_ROLES,
} from '../contract/wire/manifest.js';

const bundledMigrations = fileURLToPath(new URL(`../../${MIGRATIONS}`, import.meta.url));

export const migrationsFolder = existsSync(bundledMigrations)
  ? bundledMigrations
  : fileURLToPath(new URL(`../../../${MIGRATIONS}`, import.meta.url));

const bundledActivityMigrations = fileURLToPath(new URL(`../../${ACTIVITY_MIGRATIONS}`, import.meta.url));

export const activityMigrations = existsSync(bundledActivityMigrations)
  ? bundledActivityMigrations
  : fileURLToPath(new URL('../../../../../../packages/activity/drizzle', import.meta.url));

export const identityInput = (manifest: {
  readonly platform: InstallationPlatform;
  readonly parts: ReadonlyArray<InstallationPart>;
}): string =>
  [
    `platform ${manifest.platform.os} ${manifest.platform.arch}`,
    ...[...manifest.parts].map((part) => `part ${part.role} ${part.kind} ${part.digest} ${part.path}`).sort(),
  ].join('\n');

export const identityOf = (manifest: {
  readonly platform: InstallationPlatform;
  readonly parts: ReadonlyArray<InstallationPart>;
}): Digest => digestOf(new TextEncoder().encode(identityInput(manifest)));

export const insideClosure = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith('/') &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(path) &&
  path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

export const refusalDetail = (refusal: InstallationFailure): string => {
  switch (refusal._tag) {
    case 'InstallationMissing':
      return `no ${INSTALL_FILE} stands in ${refusal.root}`;
    case 'InstallationInvalid':
      return refusal.reason === 'mismatch'
        ? `${refusal.root} holds a changed ${refusal.role} at ${refusal.path}: it names ${refusal.expected} and stands ${refusal.found}`
        : `${refusal.root} declares an installation this reader cannot take: ${refusal.detail}`;
    case 'InstallationUnreadable':
      return `${refusal.root} could not be read at its ${refusal.role} ${refusal.path}: ${refusal.detail}`;
  }
};

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(InstallationManifest));

export const partPath = (root: string, path: string): string => (root.endsWith('/') ? `${root}${path}` : `${root}/${path}`);

const within = (root: string, resolved: string): boolean =>
  resolved === root || resolved.startsWith(root.endsWith('/') ? root : `${root}/`);

const malformed = (root: string, detail: string) => new InstallationInvalid({ root, reason: 'malformed', detail });

export const readInstallation = Effect.fn('installation.read')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files
    .readFileString(partPath(root, INSTALL_FILE))
    .pipe(
      Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
        Effect.fail(
          error.reason._tag === 'NotFound'
            ? new InstallationMissing({ root })
            : malformed(root, `the manifest could not be read: ${error.reason._tag}`),
        ),
      ),
    );
  const manifest = yield* decodeManifest(text).pipe(Effect.catchTag('SchemaError', (error) => Effect.fail(malformed(root, error.message))));

  const seen = new Set<string>();
  const roles = new Set<InstallationRole>();
  for (const part of manifest.parts) {
    if (!insideClosure(part.path)) {
      return yield* Effect.fail(malformed(root, `the part ${part.path} is named outside the closure`));
    }
    if (seen.has(part.path)) {
      return yield* Effect.fail(malformed(root, `the part ${part.path} is named twice`));
    }
    seen.add(part.path);
    roles.add(part.role);
  }
  for (const role of REQUIRED_ROLES) {
    if (!roles.has(role)) {
      return yield* Effect.fail(malformed(root, `the closure names no ${role}`));
    }
  }
  const produced = identityOf(manifest);
  if (produced !== manifest.identity.digest) {
    return yield* Effect.fail(malformed(root, `the manifest declares ${manifest.identity.digest} and its contents produce ${produced}`));
  }
  return manifest;
});

export const verifyInstallation = Effect.fn('installation.verify')(function* (root: string, unplaced: ReadonlyArray<string> = []) {
  const files = yield* FileSystem.FileSystem;
  const manifest = yield* readInstallation(root);
  const resolvedRoot = yield* files
    .realPath(root)
    .pipe(
      Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
        Effect.fail(malformed(root, `the root could not be resolved: ${error.reason._tag}`)),
      ),
    );
  for (const part of manifest.parts) {
    if (!unplaced.includes(part.path)) {
      yield* proved(files, root, resolvedRoot, part);
      continue;
    }
    if (lstatSync(partPath(root, part.path), { throwIfNoEntry: false }) !== undefined) {
      return yield* Effect.fail(malformed(root, `${part.path} stands, and this closure is placed without it`));
    }
  }
  yield* only(files, resolvedRoot, root, new Set(manifest.parts.map((part) => part.path)));
  return manifest;
});

const proved = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  root: string,
  resolvedRoot: string,
  part: InstallationPart,
): Effect.fn.Return<void, InstallationFailure> {
  const at = partPath(root, part.path);
  const unreadable = (detail: string) => new InstallationUnreadable({ root, role: part.role, path: part.path, detail });
  const mismatch = (expected: string, found: string) =>
    new InstallationInvalid({ root, reason: 'mismatch', role: part.role, path: part.path, expected, found });

  if (part.kind === 'link') {
    const target = yield* files
      .readLink(at)
      .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(unreadable(`it is no link: ${error.reason._tag}`))));
    const bytes = new TextEncoder().encode(target);
    if (bytes.length !== part.bytes) return yield* Effect.fail(mismatch(`${part.bytes} bytes`, `${bytes.length} bytes`));
    const digest = digestOf(bytes);
    if (digest !== part.digest) return yield* Effect.fail(mismatch(part.digest, digest));
    const resolved = yield* files
      .realPath(at)
      .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(unreadable(`it points nowhere: ${error.reason._tag}`))));
    if (!within(resolvedRoot, resolved)) {
      return yield* Effect.fail(unreadable(`it resolves to ${resolved}, outside the closure`));
    }
    return;
  }

  const resolved = yield* files.realPath(at).pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(unreadable(error.reason._tag))));
  if (!within(resolvedRoot, resolved)) {
    return yield* Effect.fail(unreadable(`it resolves to ${resolved}, outside the closure`));
  }
  const info = yield* files.stat(resolved).pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(unreadable(error.reason._tag))));
  if (info.type !== 'File') return yield* Effect.fail(unreadable(`it is a ${info.type}, not a file`));
  const size = Number(info.size);
  if (size !== part.bytes) return yield* Effect.fail(mismatch(`${part.bytes} bytes`, `${size} bytes`));
  const bytes = yield* files
    .readFile(resolved)
    .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(unreadable(error.reason._tag))));
  if (bytes.length !== part.bytes) {
    return yield* Effect.fail(mismatch(`${part.bytes} bytes`, `${bytes.length} bytes`));
  }
  const digest = digestOf(bytes);
  if (digest !== part.digest) return yield* Effect.fail(mismatch(part.digest, digest));
});

type PartEntry = { readonly relative: string; readonly kind: 'file' | 'link' };
type Entry = PartEntry | { readonly relative: string; readonly kind: 'directory' };

const classify = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  absolute: string,
  relative: string,
): Effect.fn.Return<Entry, PlatformError.PlatformError> {
  const link = yield* files.readLink(absolute).pipe(
    Effect.as(true),
    Effect.catchIf(
      (error) => error.reason._tag === 'Unknown' && (error.reason.cause as { readonly code?: string } | undefined)?.code === 'EINVAL',
      () => Effect.succeed(false),
    ),
  );
  if (link) return { relative, kind: 'link' } as const;
  const info = yield* files.stat(absolute);
  return { relative, kind: info.type === 'Directory' ? 'directory' : 'file' } as const;
});

const entriesUnder = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  root: string,
  within: string,
): Effect.fn.Return<ReadonlyArray<PartEntry>, PlatformError.PlatformError> {
  const here = within === '' ? root : partPath(root, within);
  const names = yield* files.readDirectory(here);
  const held: Array<PartEntry> = [];
  for (const name of [...names].sort()) {
    if (within === '' && name === DESKTOP) continue;
    const relative = within === '' ? name : `${within}/${name}`;
    const entry = yield* classify(files, partPath(root, relative), relative);
    if (entry.kind === 'directory') held.push(...(yield* entriesUnder(files, root, relative)));
    else held.push(entry);
  }
  return held;
});

const only = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  resolvedRoot: string,
  root: string,
  declared: ReadonlySet<string>,
): Effect.fn.Return<void, InstallationFailure> {
  const standing = yield* entriesUnder(files, resolvedRoot, '').pipe(
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
      Effect.fail(malformed(root, `${root} could not be walked: ${error.reason._tag}`)),
    ),
  );
  for (const entry of standing) {
    if (entry.relative === INSTALL_FILE) continue;
    if (!declared.has(entry.relative)) {
      return yield* Effect.fail(malformed(root, `${entry.relative} stands in this closure and no part names it`));
    }
  }
});

export const partsAt = Effect.fn('installation.parts')(function* (root: string, role: InstallationRole, relative: string) {
  const files = yield* FileSystem.FileSystem;
  const fail = (detail: string) => new InstallationUnreadable({ root, role, path: relative, detail });
  const entry = yield* classify(files, partPath(root, relative), relative).pipe(
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => Effect.fail(fail(error.reason._tag))),
  );
  const found =
    entry.kind === 'directory'
      ? yield* entriesUnder(files, root, relative).pipe(
          Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => Effect.fail(fail(error.reason._tag))),
        )
      : [entry];
  if (found.length === 0) return yield* Effect.fail(fail('it carries nothing'));
  const parts: Array<InstallationPart> = [];
  for (const one of found) {
    if (!insideClosure(one.relative)) {
      return yield* Effect.fail(
        new InstallationUnreadable({ root, role, path: one.relative, detail: 'its name cannot stand in a closure' }),
      );
    }
    const bytes =
      one.kind === 'link'
        ? new TextEncoder().encode(
            yield* files
              .readLink(partPath(root, one.relative))
              .pipe(
                Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
                  Effect.fail(new InstallationUnreadable({ root, role, path: one.relative, detail: error.reason._tag })),
                ),
              ),
          )
        : yield* files
            .readFile(partPath(root, one.relative))
            .pipe(
              Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
                Effect.fail(new InstallationUnreadable({ root, role, path: one.relative, detail: error.reason._tag })),
              ),
            );
    parts.push({ role, path: one.relative, kind: one.kind, bytes: bytes.length, digest: digestOf(bytes) });
  }
  return parts;
});

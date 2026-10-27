import { createHash } from 'node:crypto';
import { Data, Effect, FileSystem, type PlatformError, Schema, Stream } from 'effect';
import { bootName } from './protocol/boot';
import {
  ARTIFACT_FILE,
  HOLDER_ENTRY_FILE,
  type ArtifactContent,
  ArtifactManifest,
  type ArtifactPart,
  type ArtifactRole,
  type ArtifactStamp,
  containedPath,
  Digest,
  identityInput,
  REQUIRED_ROLES,
} from './protocol/artifact';

export class ArtifactMissing extends Data.TaggedError('ArtifactMissing')<{
  readonly root: string;
}> {}

export class ArtifactInvalid extends Data.TaggedError('ArtifactInvalid')<{
  readonly root: string;
  readonly reason: 'schema' | 'mismatch';
  readonly detail: string;
  readonly path?: string;
  readonly expected?: string;
  readonly found?: string;
}> {}

export class ArtifactUnreadable extends Data.TaggedError('ArtifactUnreadable')<{
  readonly root: string;
  readonly path: string;
  readonly detail: string;
}> {}

export type ArtifactFailure = ArtifactMissing | ArtifactInvalid | ArtifactUnreadable;

const HASHED_CHUNK = 1024 * 1024;

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactManifest));
const readDigest = Schema.decodeUnknownSync(Digest);

export const digestOf = (bytes: Uint8Array): Digest => readDigest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);

export const identityOf = (manifest: ArtifactContent): Digest => digestOf(new TextEncoder().encode(identityInput(manifest)));

export const stampOf = (manifest: ArtifactManifest): ArtifactStamp => {
  const { identity, protocol } = manifest;
  return { identity, protocol, wire: manifest.wire.max, range: manifest.wire };
};

const joined = (root: string, path: string): string => (root.endsWith('/') ? `${root}${path}` : `${root}/${path}`);

const within = (root: string, resolved: string): boolean =>
  resolved === root || resolved.startsWith(root.endsWith('/') ? root : `${root}/`);

export const readArtifact = Effect.fn('executions.readArtifact')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files
    .readFileString(joined(root, ARTIFACT_FILE))
    .pipe(
      Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
        Effect.fail(
          error.reason._tag === 'NotFound'
            ? new ArtifactMissing({ root })
            : new ArtifactInvalid({ root, reason: 'schema', detail: `the manifest could not be read: ${error.reason._tag}` }),
        ),
      ),
    );
  const manifest = yield* decodeManifest(text).pipe(
    Effect.catchTag('SchemaError', (error) => Effect.fail(new ArtifactInvalid({ root, reason: 'schema', detail: error.message }))),
  );

  if (!containedPath(manifest.endpoint.path)) {
    return yield* new ArtifactInvalid({ root, reason: 'schema', detail: 'the endpoint is not a relative path within the state directory' });
  }
  const seen = new Set<string>();
  const roles = new Set<ArtifactRole>();
  for (const part of manifest.parts) {
    if (part.path === ARTIFACT_FILE || part.path === HOLDER_ENTRY_FILE) {
      return yield* new ArtifactInvalid({ root, reason: 'schema', detail: `${part.path} is derived metadata, not a hashed part` });
    }
    if (!containedPath(part.path)) {
      return yield* new ArtifactInvalid({ root, reason: 'schema', detail: `the part ${part.path} is named outside the bundle` });
    }
    if (seen.has(part.path)) {
      return yield* new ArtifactInvalid({ root, reason: 'schema', detail: `the part ${part.path} is named twice` });
    }
    if (roles.has(part.role) && ['runtime', 'holder', 'host', 'platform', 'recovery'].includes(part.role)) {
      return yield* new ArtifactInvalid({ root, reason: 'schema', detail: `the closure names more than one ${part.role}` });
    }
    seen.add(part.path);
    roles.add(part.role);
  }
  return manifest;
});

export const verifyArtifact = Effect.fn('executions.verifyArtifact')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const manifest = yield* readArtifact(root);
  const roles = new Set(manifest.parts.map((part) => part.role));
  for (const role of REQUIRED_ROLES) {
    if (!roles.has(role)) {
      return yield* new ArtifactInvalid({ root, reason: 'schema', detail: `the closure names no ${role}` });
    }
  }
  const produced = identityOf(manifest);
  if (produced !== manifest.identity.digest) {
    return yield* new ArtifactInvalid({
      root,
      reason: 'schema',
      detail: `the manifest declares ${manifest.identity.digest} and its contents produce ${produced}`,
    });
  }
  const resolvedRoot = yield* files
    .realPath(root)
    .pipe(
      Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
        Effect.fail(new ArtifactInvalid({ root, reason: 'schema', detail: `the bundle root could not be resolved: ${error.reason._tag}` })),
      ),
    );
  const entry = holderEntryOf(manifest);
  if (entry === undefined) {
    return yield* new ArtifactInvalid({ root, reason: 'schema', detail: 'the holder entry has no launch roles' });
  }
  const bytes = new TextEncoder().encode(entry);
  yield* proved(files, root, resolvedRoot, { role: 'metadata', path: HOLDER_ENTRY_FILE, bytes: bytes.length, digest: digestOf(bytes) });
  for (const part of manifest.parts) yield* proved(files, root, resolvedRoot, part);
  yield* only(files, resolvedRoot, root, new Set(manifest.parts.map((part) => part.path)));
  return manifest;
});

const only = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  resolvedRoot: string,
  root: string,
  declared: ReadonlySet<string>,
  within = '',
): Effect.fn.Return<void, ArtifactFailure> {
  const here = within === '' ? resolvedRoot : `${resolvedRoot}/${within}`;
  const entries = yield* files
    .readDirectory(here)
    .pipe(
      Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
        Effect.fail(new ArtifactInvalid({ root, reason: 'schema', detail: `${here} could not be read: ${error.reason._tag}` })),
      ),
    );
  for (const entry of entries) {
    const relative = within === '' ? entry : `${within}/${entry}`;
    if (relative === ARTIFACT_FILE || relative === HOLDER_ENTRY_FILE) continue;
    const info = yield* files
      .stat(`${resolvedRoot}/${relative}`)
      .pipe(
        Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
          Effect.fail(new ArtifactUnreadable({ root, path: relative, detail: error.reason._tag })),
        ),
      );
    if (info.type === 'Directory') {
      yield* only(files, resolvedRoot, root, declared, relative);
      continue;
    }
    if (!declared.has(relative)) {
      return yield* new ArtifactInvalid({ root, reason: 'schema', detail: `${relative} stands in this bundle and no part names it` });
    }
  }
});

const proved = Effect.fnUntraced(function* (files: FileSystem.FileSystem, root: string, resolvedRoot: string, part: ArtifactPart) {
  const unreadable = (detail: string) => new ArtifactUnreadable({ root, path: part.path, detail });
  const mismatched = (expected: string, found: string) =>
    new ArtifactInvalid({
      root,
      reason: 'mismatch',
      detail: `${part.path}: expected ${expected}, found ${found}`,
      path: part.path,
      expected,
      found,
    });
  const resolved = yield* files
    .realPath(joined(root, part.path))
    .pipe(Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => Effect.fail(unreadable(error.reason._tag))));
  if (!within(resolvedRoot, resolved)) {
    return yield* unreadable(`it resolves to ${resolved}, outside the bundle`);
  }
  const info = yield* files
    .stat(resolved)
    .pipe(Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => Effect.fail(unreadable(error.reason._tag))));
  if (info.type !== 'File') return yield* unreadable(`it is a ${info.type}, not a file`);
  const size = Number(info.size);
  if (size !== part.bytes) {
    return yield* mismatched(`${part.bytes} bytes`, `${size} bytes`);
  }
  const hash = createHash('sha256');
  let read = 0;
  yield* files.stream(resolved, { chunkSize: HASHED_CHUNK }).pipe(
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        read += chunk.length;
        hash.update(chunk);
      }),
    ),
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => Effect.fail(unreadable(error.reason._tag))),
  );
  if (read !== part.bytes) {
    return yield* mismatched(`${part.bytes} bytes`, `${read} bytes`);
  }
  const digest = readDigest(`sha256:${hash.digest('hex')}`);
  if (digest !== part.digest) {
    return yield* mismatched(part.digest, digest);
  }
});

export const partOf = (manifest: ArtifactManifest, role: ArtifactRole): ArtifactPart | undefined =>
  manifest.parts.find((part) => part.role === role);

export const holderEntryOf = (manifest: ArtifactManifest): string | undefined => {
  const holder = partOf(manifest, 'holder')?.path;
  const runtime = partOf(manifest, 'runtime')?.path;
  const host = partOf(manifest, 'host')?.path;
  if (holder === undefined || runtime === undefined || host === undefined) return undefined;
  if (![holder, runtime, host].every(containedPath)) return undefined;
  return `holder ${holder}\nbundle ${runtime}\nbundle ${host}\nstate ${bootName(manifest.identity.digest)}\n`;
};

export const pathOf = (root: string, manifest: ArtifactManifest, role: ArtifactRole): string | undefined => {
  const part = partOf(manifest, role);
  return part === undefined ? undefined : joined(root, part.path);
};

export const boundTo = Effect.fn('executions.boundTo')(function* (
  root: string,
  manifest: ArtifactManifest,
  role: ArtifactRole,
  used: string,
) {
  const files = yield* FileSystem.FileSystem;
  const named = pathOf(root, manifest, role);
  if (named === undefined) return false;
  const resolve = (path: string) =>
    files
      .realPath(path)
      .pipe(
        Effect.catchTag('PlatformError', (error) =>
          error.reason._tag === 'NotFound' ? Effect.succeed(undefined) : new ArtifactUnreadable({ root, path, detail: error.message }),
        ),
      );
  const declared = yield* resolve(named);
  const actual = yield* resolve(used);
  return declared !== undefined && actual !== undefined && declared === actual;
});

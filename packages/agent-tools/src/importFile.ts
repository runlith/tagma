import { dirname } from 'node:path';
import { Data, Effect, FileSystem, type PlatformError } from 'effect';
import { inTurn, recording } from './changed';
import type { Standing } from '@runlith/files/replace';
import { aliasRefusal, entryIdentity, storedOf } from './namespace';
import { withoutAddedProse } from './prose';
import type { ToolFailed } from '@runlith/agent/tool';
import { refused } from './refusals';
import { unboundTool, type WorkspaceRefused } from './ToolEdge';
import type { ToolFactoryOptions } from './workspace';
import { resolveToolOptions, resolveWorkspacePath, withNamedEntry } from './workspace/runtime';
import { contentDigest, fileContent, type FileContent } from '@runlith/files/content';
import type { ImportNamespace, ImportSourceRefused, WorkspaceImports } from './WorkspaceImports';

export const IMPORT_BASE_ABSENT = 'absent';

export type ImportRequest = {
  readonly source: ImportNamespace;
  readonly from: string;
  readonly to: string;
  readonly expect: string;
};

export type ImportLanded = {
  readonly path: string;
  readonly created: boolean;
  readonly digest: string;
  readonly lines: number;
  readonly from: string;
  readonly comments: string;
  readonly recorded: boolean;
};

export class ImportRefused extends Data.TaggedError('ImportRefused')<{
  readonly code: 'expected-base';
  readonly reason: string;
  readonly actual?: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export type ImportFailure = ImportRefused | ImportSourceRefused | ToolFailed | WorkspaceRefused | PlatformError.PlatformError;

export function importFile(
  options: ToolFactoryOptions,
  imports: WorkspaceImports,
  request: ImportRequest,
): Effect.Effect<ImportLanded, ImportFailure> {
  const resolved = resolveToolOptions(options);
  const files = resolved.world.files;
  if (files === undefined) return unboundTool('import', 'filesystem');
  return Effect.provide(
    Effect.flatMap(resolveWorkspacePath(resolved, request.to, { allowMissing: true }), (destination) =>
      inTurn(resolved, destination, withNamedEntry(resolved.cwd, destination, run(resolved, imports, request, destination))),
    ),
    files,
  );
}

const run = Effect.fn('importFile.run')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  imports: WorkspaceImports,
  request: ImportRequest,
  destination: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const identity = yield* entryIdentity(destination);
  if (identity.kind === 'alias' || identity.kind === 'taken') {
    return yield* refused('aliased', aliasRefusal(resolved.cwd, destination, storedOf(identity)));
  }
  yield* based(request, yield* textAt(fs, destination), destination);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const source = yield* imports.open(request.source, request.from);
      const standing = yield* contentAt(fs, destination);
      const before = standing?.text;
      yield* based(request, before, destination);
      yield* fs.makeDirectory(dirname(destination), { recursive: true });
      const landing = yield* withoutAddedProse(resolved, destination, before ?? '', source.text);
      const kept = yield* recording(resolved, 'write', destination, {
        standing: standingOf(standing),
        before: before ?? '',
        after: landing.text,
      });
      return {
        path: destination,
        created: before === undefined,
        digest: contentDigest(landing.text),
        lines: landing.text === '' ? 0 : landing.text.split('\n').length,
        from: source.from,
        comments: landing.sentence.trim(),
        recorded: kept.kept,
      } satisfies ImportLanded;
    }),
  );
});

export function contentAt(fs: FileSystem.FileSystem, path: string): Effect.Effect<FileContent | undefined, PlatformError.PlatformError> {
  return fileContent(fs, path).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === 'NotFound',
      () => Effect.succeed(undefined),
    ),
  );
}

export function textAt(fs: FileSystem.FileSystem, path: string): Effect.Effect<string | undefined, PlatformError.PlatformError> {
  return Effect.map(contentAt(fs, path), (content) => content?.text);
}

export const standingOf = (content: FileContent | undefined): Standing =>
  content === undefined ? { absent: true } : { bytes: content.bytes };

function based(request: ImportRequest, before: string | undefined, destination: string): Effect.Effect<void, ImportRefused> {
  const actual = before === undefined ? IMPORT_BASE_ABSENT : contentDigest(before);
  if (request.expect === actual) return Effect.void;
  return Effect.fail(
    new ImportRefused({
      code: 'expected-base',
      actual,
      reason:
        actual === IMPORT_BASE_ABSENT
          ? `${destination} was expected to hold ${request.expect}, and nothing stands there. Import again with expect: ${IMPORT_BASE_ABSENT}.`
          : request.expect === IMPORT_BASE_ABSENT
            ? `${destination} already holds ${actual}, and the import expected nothing there. Read it, then import again naming that digest.`
            : `${destination} holds ${actual}, not the ${request.expect} this import expected: it moved since it was read. Read it again, then import naming what it holds.`,
    }),
  );
}

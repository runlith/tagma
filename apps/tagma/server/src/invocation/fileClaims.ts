import { isAbsolute, resolve } from 'node:path';
import { Effect, type FileSystem, type Layer } from 'effect';
import { fileFailure, resourcePath } from '@runlith/files/replace';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { type Claim, ToolFailed } from '@runlith/agent/tool';

export const fileSubjectClaims = (
  files: Layer.Layer<FileSystem.FileSystem> | undefined,
  root: string | undefined,
  subjects: readonly PermissionSubject[],
): Effect.Effect<readonly Claim[], ToolFailed> =>
  Effect.forEach(subjects, (subject) => {
    if (subject.file !== true || (subject.kind !== 'read' && subject.kind !== 'write')) return Effect.succeed([]);
    const access = subject.kind;
    const named = root === undefined || isAbsolute(subject.value) ? subject.value : resolve(root, subject.value);
    const canonical =
      files === undefined
        ? Effect.succeed(named)
        : resourcePath(named).pipe(
            Effect.provide(files),
            Effect.mapError(
              (error) => new ToolFailed({ reason: `${named} could not be resolved to order this call: ${fileFailure(error)}` }),
            ),
          );
    return Effect.map(canonical, (path): readonly Claim[] => [{ on: { kind: 'file', path }, access }]);
  }).pipe(Effect.map((claims) => claims.flat()));

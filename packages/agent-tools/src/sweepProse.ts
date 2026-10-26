import { Effect, FileSystem } from 'effect';
import { readComments, stripProse } from '@runlith/source-comments';
import { inTurn, recording } from './changed';
import { contentAt } from './importFile';
import { unboundTool, type ToolEdgeFailure } from './ToolEdge';
import type { ResolvedToolOptions, ToolFactoryOptions } from './workspace';
import { resolveToolOptions, resolveWorkspacePath, withEntryWrite } from './workspace/runtime';

export type SweptFile =
  | { readonly path: string; readonly swept: 'stripped'; readonly dropped: number }
  | { readonly path: string; readonly swept: 'unrecorded'; readonly dropped: number }
  | { readonly path: string; readonly swept: 'clean' }
  | { readonly path: string; readonly swept: 'exempt' }
  | { readonly path: string; readonly swept: 'unlexable'; readonly reason: string };

export function sweepProse(options: ToolFactoryOptions, files: readonly string[]): Effect.Effect<readonly SweptFile[], ToolEdgeFailure> {
  const resolved = resolveToolOptions(options);
  const bound = resolved.world.files;
  if (bound === undefined) return unboundTool('strip comments', 'filesystem');
  return Effect.provide(
    Effect.forEach(files, (file) => swept(resolved, file)),
    bound,
  );
}

const swept = Effect.fn('sweepProse.file')(function* (resolved: ResolvedToolOptions, file: string) {
  const target = yield* resolveWorkspacePath(resolved, file);
  return yield* inTurn(resolved, target, withEntryWrite(resolved.cwd, target, sweptFile(resolved, target)));
});

const sweptFile = Effect.fn('sweepProse.swept')(function* (
  resolved: ResolvedToolOptions,
  target: string,
): Effect.fn.Return<SweptFile, ToolEdgeFailure, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const read = yield* contentAt(fs, target);
  if (read === undefined) return { path: target, swept: 'clean' };
  const before = read.text;
  const reading = readComments(target, before);
  if (!reading.lexed) return { path: target, swept: 'unlexable', reason: reading.reason };
  if (reading.exempt) return { path: target, swept: 'exempt' };
  if (!reading.comments.some((comment) => comment.kind === 'prose')) return { path: target, swept: 'clean' };
  const stripped = stripProse(target, before);
  if (stripped.dropped.length === 0) return { path: target, swept: 'clean' };
  const kept = yield* recording(resolved, 'write', target, { standing: { bytes: read.bytes }, before, after: stripped.text });
  return { path: target, swept: kept.kept ? 'stripped' : 'unrecorded', dropped: stripped.dropped.length };
});

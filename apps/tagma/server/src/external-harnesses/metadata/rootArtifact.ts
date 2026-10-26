import { Effect, type FileSystem } from 'effect';
import { dirname } from 'node:path';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { claude } from '../vendors/claude-code/metadata.js';
import { codex } from '../vendors/codex/metadata.js';
import { MetadataFile } from './file.js';
import { METADATA_LIMITS } from './policy.js';

export type RootArtifactRead =
  | { readonly _tag: 'Bound' }
  | { readonly _tag: 'Refused'; readonly reason: string }
  | { readonly _tag: 'Unreadable'; readonly reason: string };

const ARTIFACT_PAGES = Math.ceil(METADATA_LIMITS.recordBytes / METADATA_LIMITS.bytes) + 1;

export function readRootArtifact(
  files: FileSystem.FileSystem,
  adapter: HarnessAdapter,
  rootKey: string,
  artifact: string,
): Effect.Effect<RootArtifactRead> {
  if (adapter.metadata === 'codex-rollout')
    return binding(new MetadataFile(codex(rootKey), METADATA_LIMITS), files, artifact, ARTIFACT_PAGES);
  if (adapter.metadata === 'claude-jsonl')
    return binding(new MetadataFile(claude(rootKey), METADATA_LIMITS), files, artifact, Number.POSITIVE_INFINITY);
  return Effect.succeed({ _tag: 'Unreadable', reason: 'artifact-fold-unavailable' } as const);
}

const binding = Effect.fn('HarnessPrepare.artifact')(
  function* <A extends { readonly bound: boolean }>(
    cursor: MetadataFile<A>,
    files: FileSystem.FileSystem,
    artifact: string,
    pages: number,
  ) {
    const root = dirname(artifact);
    for (let at = 0; at < pages; at++) {
      const page = yield* cursor.read(files, root, artifact);
      if (page._tag === 'Absent') return { _tag: 'Refused', reason: 'the artifact this mint named does not exist' } as RootArtifactRead;
      if (page._tag === 'Unreadable') {
        return (
          page.reason === 'identity' || page.reason === 'malformed'
            ? { _tag: 'Refused', reason: `the artifact does not open on this root: ${page.reason}` }
            : { _tag: 'Unreadable', reason: page.reason }
        ) as RootArtifactRead;
      }
      if (page.value.bound) return { _tag: 'Bound' } as RootArtifactRead;
      if (page.complete) return { _tag: 'Refused', reason: 'the artifact names no session of this root' } as RootArtifactRead;
    }
    return { _tag: 'Unreadable', reason: 'limit' } as RootArtifactRead;
  },
  Effect.tap((read) =>
    read._tag === 'Bound'
      ? Effect.withSpan(Effect.void, 'HarnessPrepare.artifact.bound')
      : read._tag === 'Refused'
        ? Effect.withSpan(Effect.void, 'HarnessPrepare.artifact.refused')
        : Effect.withSpan(Effect.void, 'HarnessPrepare.artifact.unreadable'),
  ),
);

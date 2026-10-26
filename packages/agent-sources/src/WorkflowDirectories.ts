import * as path from 'node:path';
import { parseWorkflowDefinition } from '@runlith/agent/workflow/compile';
import type { WorkflowDefinition } from '@runlith/agent/workflow/definition';
import { Effect, FileSystem } from 'effect';

export const WORKFLOW_SUFFIX = '.json';

export type WorkflowSourceRequest = {
  readonly directories: readonly string[];
};

export type DiscoveredWorkflow = {
  readonly definition: WorkflowDefinition;
  readonly path: string;
  readonly directory: string;
  readonly revision: string;
};

export type WorkflowDiscovery = {
  readonly workflows: readonly DiscoveredWorkflow[];
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
};

export const discoverWorkflows = Effect.fn('WorkflowDirectories.discover')(function* (request: WorkflowSourceRequest) {
  const fs = yield* FileSystem.FileSystem;
  const byName = new Map<string, DiscoveredWorkflow>();
  const rejected: { path: string; reason: string }[] = [];

  for (const directory of request.directories) {
    const present = yield* fs.exists(directory).pipe(Effect.option);
    if (present._tag === 'None') {
      rejected.push({ path: directory, reason: 'unreadable' });
      continue;
    }
    if (!present.value) continue;
    const listed = yield* fs.readDirectory(directory).pipe(Effect.option);
    if (listed._tag === 'None') {
      rejected.push({ path: directory, reason: 'unreadable' });
      continue;
    }
    for (const entry of listed.value.slice().sort()) {
      if (!entry.endsWith(WORKFLOW_SUFFIX)) continue;
      const file = path.join(directory, entry);
      const raw = yield* fs.readFileString(file).pipe(Effect.option);
      if (raw._tag === 'None') {
        rejected.push({ path: file, reason: 'unreadable' });
        continue;
      }
      const parsed = parseDefinition(raw.value);
      if ('reason' in parsed) {
        rejected.push({ path: file, reason: parsed.reason });
        continue;
      }
      byName.set(parsed.definition.name, { ...parsed, path: file, directory });
    }
  }

  return { workflows: [...byName.values()], rejected } satisfies WorkflowDiscovery;
});

function parseDefinition(text: string): { definition: WorkflowDefinition; revision: string } | { reason: string } {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : 'unreadable json' };
  }
  try {
    return { definition: parseWorkflowDefinition(document), revision: revisionOf(text) };
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : 'not a workflow definition' };
  }
}

function revisionOf(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(16);
}

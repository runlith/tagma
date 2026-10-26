import * as path from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { discoverWorkflows } from '@runlith/agent-sources/WorkflowDirectories';
import { WorkflowLibrary, type WorkflowSource, type WorkflowUnread } from '@runlith/agent/workflow/library';
import { Effect } from 'effect';
import { CHECKOUT_DIRECTORY, WORKFLOWS_DIRECTORY } from '../../graph/contract/wire/storage.js';

export const WORKFLOW_DIRECTORY = path.join(CHECKOUT_DIRECTORY, WORKFLOWS_DIRECTORY);

export const WORKFLOW_VOCABULARY = { seams: ['standing-proposals'], conditions: [] as string[] };

export const readWorkflowLibrary = Effect.fn('workflowSources.library')(function* (input: {
  readonly projectRoot: string;
  readonly dataPath: string | null;
}) {
  const floors: readonly { floor: WorkflowSource['floor']; directory: string }[] = [
    ...(input.dataPath === null ? [] : [{ floor: 'user' as const, directory: path.join(input.dataPath, WORKFLOWS_DIRECTORY) }]),
    { floor: 'project' as const, directory: path.join(input.projectRoot, WORKFLOW_DIRECTORY) },
  ];
  const sources: WorkflowSource[] = [];
  const unread: WorkflowUnread[] = [];
  for (const { floor, directory } of floors) {
    const found = yield* discoverWorkflows({ directories: [directory] }).pipe(Effect.provide(BunFileSystem.layer));
    for (const rejected of found.rejected) unread.push({ floor, path: rejected.path, reason: rejected.reason });
    for (const workflow of found.workflows) {
      sources.push({ floor, definition: workflow.definition, revision: workflow.revision });
    }
  }
  return new WorkflowLibrary(sources, WORKFLOW_VOCABULARY, unread);
});

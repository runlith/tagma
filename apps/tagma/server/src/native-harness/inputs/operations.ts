import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { WorkspaceInputs, type WorkspaceInputSet } from '../contract/service/inputs.js';
import { INPUT_OPERATIONS as OPS, type InputOperationId } from '../contract/wire/operations/inputs.js';
import { skillInventory } from '../skills/pool.js';

const inventory = Effect.fn('workspaceSources.inventory')(function* (walked: WorkspaceInputSet) {
  return {
    skills: skillInventory(yield* ArtifactStore, walked),
    contextFiles: walked.contextFiles.map((file) => ({ path: file.path, name: file.name })),
    rejected: walked.rejected,
  };
});

const walkCurrent = Effect.fn('workspaceSources.walk')(function* () {
  const call = yield* yield* CurrentProject;
  const project = yield* (yield* Projects).byId(call.project.id);
  return yield* inventory(yield* (yield* WorkspaceInputs).walk(project.id, project.rootPath));
});

export const INPUT_PAIRS: { readonly [K in InputOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_workspace_sources: pair(
    OPS.read_workspace_sources,
    body(OPS.read_workspace_sources, {
      execute: () => Effect.map(walkCurrent(), (read) => ({ status: 'read' as const, ...read })),
    }),
  ),
  reload_workspace_sources: pair(
    OPS.reload_workspace_sources,
    body(OPS.reload_workspace_sources, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* CurrentProject;
        yield* (yield* WorkspaceInputs).invalidate({ projectId: call.project.id });
        return { status: 'reloaded' as const, ...(yield* walkCurrent()) };
      }),
    }),
  ),
};

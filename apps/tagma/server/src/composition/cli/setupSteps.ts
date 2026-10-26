import { Effect } from 'effect';
import type { SetupSteps } from '../../installation/contract/service/steps.js';
import { entryCommand } from '../../installation/contract/wire/junction.js';
import { installMcpDeclarations } from '../../external-harnesses/installs/mcpDeclaration.js';

export const mcpDeclarationSteps: SetupSteps['Service'] = {
  run: (repoRoot) => Effect.promise(() => installMcpDeclarations(repoRoot, entryCommand(process.env))),
};

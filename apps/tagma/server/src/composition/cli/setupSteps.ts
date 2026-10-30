import { Effect } from 'effect';
import type { SetupSteps } from '../../installation/contract/service/steps.js';
import { entryCommand } from '../../installation/contract/wire/junction.js';
import { installFailure } from '../../installation/contract/wire/install.js';
import { HarnessAdapters } from '../../external-harnesses/contract/service/adapters.js';
import { installMcpDeclarations } from '../../external-harnesses/installs/mcpDeclaration.js';
import { installerAdapters } from './installerAdapters.js';

export const mcpDeclarationSteps: SetupSteps['Service'] = {
  run: (repoRoot) =>
    Effect.flatMap(HarnessAdapters, (adapters) =>
      Effect.tryPromise({ try: () => installMcpDeclarations(adapters.all(), repoRoot, entryCommand(process.env)), catch: installFailure }),
    ).pipe(Effect.provide(installerAdapters)),
};

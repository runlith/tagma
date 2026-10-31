import { Effect } from 'effect';
import type { SetupSteps } from '../../installation/contract/service/steps.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import { entryCommand } from '../../installation/contract/wire/junction.js';
import { installFailure } from '../../installation/contract/wire/install.js';
import { mcpDeclarations } from '../../external-harnesses/installs/mcpDeclaration.js';
import { installerAdapters } from './installerAdapters.js';

export const mcpDeclarationSteps = (channel: Channel): SetupSteps['Service'] => ({
  run: (repoRoot) =>
    Effect.flatMap(mcpDeclarations(entryCommand(process.env)), (declare) =>
      Effect.tryPromise({ try: () => declare(repoRoot), catch: installFailure }),
    ).pipe(Effect.provide(installerAdapters(channel))),
});

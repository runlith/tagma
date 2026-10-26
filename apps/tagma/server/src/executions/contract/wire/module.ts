import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const executions = {
  id: 'executions',
  title: 'Managed executions and bounded commands',
  operations: async () => {
    const [
      { COMMAND_OPERATIONS },
      { COMMAND_RULE_OPERATIONS },
      { LANE_OPERATIONS },
      { RESIDUAL_OPERATIONS },
      { TERMINAL_OPERATIONS },
      { MACHINE_OPERATIONS },
      { REFUSAL_WORDS },
    ] = await Promise.all([
      import('./operations/commandCatalog.js'),
      import('./operations/commandRules.js'),
      import('./operations/lanes.js'),
      import('./operations/residuals.js'),
      import('./operations/terminalCatalog.js'),
      import('./operations/machine.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: mergeOperations(
        TERMINAL_OPERATIONS,
        LANE_OPERATIONS,
        RESIDUAL_OPERATIONS,
        MACHINE_OPERATIONS,
        COMMAND_OPERATIONS,
        COMMAND_RULE_OPERATIONS,
      ),
      refusals: REFUSAL_WORDS,
    } as const;
  },
} as const satisfies OperationManifest;

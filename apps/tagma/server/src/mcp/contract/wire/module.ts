import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const mcp = {
  id: 'mcp',
  title: 'The MCP servers',
  operations: async () => {
    const [{ MCP_OPERATIONS, MCP_APP_OPERATIONS, MCP_SIGN_IN_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([
      import('./operations.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: mergeOperations(MCP_OPERATIONS, MCP_APP_OPERATIONS, MCP_SIGN_IN_OPERATIONS),
      refusals: REFUSAL_WORDS,
    } as const;
  },
} as const satisfies OperationManifest;

import { mergeOperations, type WireModule } from '../../../platform/contract/wire/manifest.js';
import { MCP_FEEDS } from './feeds.js';

export const mcp = {
  id: 'mcp',
  title: 'The MCP servers',
  operations: async () => {
    const [{ MCP_OPERATIONS, MCP_APP_OPERATIONS, MCP_CONTRIBUTED_OPERATIONS, MCP_SIGN_IN_OPERATIONS }, { REFUSAL_WORDS }] =
      await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return {
      declarations: mergeOperations(MCP_OPERATIONS, MCP_APP_OPERATIONS, MCP_CONTRIBUTED_OPERATIONS, MCP_SIGN_IN_OPERATIONS),
      refusals: REFUSAL_WORDS,
    } as const;
  },
  feeds: MCP_FEEDS,
} as const satisfies WireModule;

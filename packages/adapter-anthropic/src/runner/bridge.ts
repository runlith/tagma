import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { TAGMA_SERVER, type Bridge, type BridgeVendor } from '@runlith/hosted-runner/bridge';

const TOOL_USE_META = 'claudecode/toolUseId';

export const claudeVendor: BridgeVendor = {
  name: 'Claude Code',
  callIdOf: (meta) => {
    const toolUseId = meta[TOOL_USE_META];
    return typeof toolUseId === 'string' && toolUseId !== '' ? toolUseId : null;
  },
  relists: true,
};

export const claudeConfig = (bridge: Bridge): McpSdkServerConfigWithInstance => ({
  type: 'sdk',
  name: TAGMA_SERVER,
  instance: bridge.server,
});

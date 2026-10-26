import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { agentMeta, isRecord } from './meta.js';

const CAPABILITIES = [
  'agents',
  'files',
  'shell',
  'web',
  'mcp',
  'plugins',
  'skills',
  'threads',
  'peers',
  'resources',
  'sandbox',
  'worktrees',
  'terminals',
  'artifacts',
  'reflections',
];

export const developerForm: ThreadFormStep = {
  name: '20261017150000_developer_agent',
  samples: { meta: { record: { agentId: 'code' }, native: { profile: null, transport: { adapter: 'native' } } } },
  meta: (meta) => {
    const read = agentMeta(meta);
    if (read === null) return null;
    const { agentId, transport, profile, overlay } = read;
    const fromCode = agentId === 'code' || transport?.agent === 'code';
    if (!fromCode && overlay?.baseAgentId !== 'code') return null;
    return read.with({
      agentId: agentId === 'code' ? 'developer' : agentId,
      profile:
        profile == null && fromCode
          ? { id: 'developer', overlay: { id: 'developer', baseAgentId: 'developer', description: '', capabilities: CAPABILITIES } }
          : isRecord(profile) && overlay?.baseAgentId === 'code'
            ? { ...profile, overlay: { ...overlay, baseAgentId: 'developer', capabilities: overlay.capabilities ?? CAPABILITIES } }
            : profile,
      transport: transport?.agent === 'code' ? { ...transport, agent: 'developer' } : undefined,
    });
  },
};

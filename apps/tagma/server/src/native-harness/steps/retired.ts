import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { agentMeta, isRecord } from './meta.js';

const HEIR = 'tagma';

const sampleOf = (gone: string): ThreadFormStep['samples'] => ({
  meta: { record: { agentId: gone }, native: { profile: null, transport: { adapter: 'native' } } },
});

const movedOnto =
  (gone: string): ThreadFormStep['meta'] =>
  (meta) => {
    const renamed = (value: unknown): unknown => (value === gone ? HEIR : value);
    const read = agentMeta(meta);
    if (read === null) return null;
    const { agentId, transport, profile, overlay } = read;
    const derived = overlay !== null && overlay.baseAgentId === gone;
    if (agentId !== gone && transport?.agent !== gone && !derived) return null;
    return read.with({
      agentId: renamed(agentId),
      profile:
        derived && isRecord(profile)
          ? { ...profile, id: renamed(profile.id), overlay: { ...overlay, id: renamed(overlay.id), baseAgentId: HEIR } }
          : profile,
      transport: transport?.agent === gone ? { ...transport, agent: HEIR } : undefined,
    });
  };

export const developerRetired: ThreadFormStep = {
  name: '20261017161000_developer_retired',
  samples: sampleOf('developer'),
  meta: movedOnto('developer'),
};

export const rulesRetired: ThreadFormStep = {
  name: '20261020153000_rules_retired',
  samples: sampleOf('rules'),
  meta: movedOnto('rules'),
};

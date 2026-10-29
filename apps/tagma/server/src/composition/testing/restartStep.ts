import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';

export const RESTART_STEP_ENV = 'RESTART_RIG_STEP';

const WHOLE_SECOND = '.000Z';

export const restartStep: ThreadFormStep = {
  name: '20261031000000_restart_rig_whole_second',
  samples: {
    entry: { type: 'message', id: 'm', role: 'user', text: 'hello', occurredAt: `2026-01-01T00:00:00${WHOLE_SECOND}` },
  },
  entry: (entry) => {
    if (entry.type !== 'message' || typeof entry.occurredAt !== 'string' || !entry.occurredAt.endsWith(WHOLE_SECOND)) return null;
    return { ...entry, occurredAt: `${entry.occurredAt.slice(0, -WHOLE_SECOND.length)}Z` };
  },
};

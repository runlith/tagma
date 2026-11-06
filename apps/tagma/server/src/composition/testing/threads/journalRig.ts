import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { manifest } from '../../../platform/contract/service/manifest.js';
import { serverParts } from '../../build.js';
import { PARTS } from '../../developer/parts.js';
import { MODULES } from '../../developer/modules.js';

const renamed = (from: string, to: string) => (entry: Readonly<Record<string, unknown>>) =>
  typeof entry.toolName === 'string' && entry.toolName.startsWith(from)
    ? { ...entry, toolName: `${to}${entry.toolName.slice(from.length)}` }
    : null;

export const RIG_REFUSED = 'rigged__refused';

const returned = renamed('rigged__', 'rig__');

export const RIG_STEP: ThreadFormStep = {
  name: '29991231000000_rigged_tools',
  samples: { entry: { type: 'tool', id: 'e', toolName: 'rig__deal', toolCallId: 'c' } },
  entry: renamed('rig__', 'rigged__'),
  back: {
    entry: (entry) => {
      if (entry.toolName === RIG_REFUSED) throw new Error('this rigged tool has no name to return to');
      return returned(entry);
    },
    holds: ['rigged__'],
  },
};

export const RIG_MODULES = [...MODULES, manifest({ id: 'journal-rig', formSteps: [RIG_STEP] })];

const rigged = (): Worker => new Worker(new URL('./journalRig.worker.ts', import.meta.url), { type: 'module' });

export const RIG_PARTS = serverParts({ ...PARTS, modules: RIG_MODULES, rested: rigged });

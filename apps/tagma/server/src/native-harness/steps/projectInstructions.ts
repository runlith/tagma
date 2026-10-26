import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { instructionsTold } from '../turns/instructions.js';
import { isRecord } from './meta.js';

export const instructionForm: ThreadFormStep = {
  name: '20261010233000_project_instructions',
  samples: { message: { metadata: { runtimeState: { 'project-instructions': { projectId: 1 } } } } },
  message: (message) => {
    if (!isRecord(message.metadata) || !isRecord(message.metadata.runtimeState)) return null;
    const { 'project-instructions': previous, ...state } = message.metadata.runtimeState;
    if (!isRecord(previous) || typeof previous.projectId !== 'number' || !Number.isInteger(previous.projectId)) return null;
    const key = instructionsTold(previous.projectId);
    return { ...message, metadata: { ...message.metadata, runtimeState: { ...state, [key]: state[key] ?? previous } } };
  },
};

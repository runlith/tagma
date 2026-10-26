import { Schema } from 'effect';
import { instructionStateSchema } from '../../../graph/contract/wire/instructions.js';
import { workspaceInventorySchema } from './sourceSettings.js';

export const THREAD_INSTRUCTION_OUTCOMES = ['updated', 'current'] as const;
export type InstructionStatus = (typeof THREAD_INSTRUCTION_OUTCOMES)[number];

export const threadInstructionsResultSchema = Schema.Struct({
  status: Schema.Literals(THREAD_INSTRUCTION_OUTCOMES),
  sources: workspaceInventorySchema,
  instructions: instructionStateSchema,
});
export type ThreadInstructionsRefreshed = typeof threadInstructionsResultSchema.Type;

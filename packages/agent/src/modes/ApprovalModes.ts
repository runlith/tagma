import { Context, Layer } from 'effect';
import { makeModeRegistry, type ModeRegistry } from './ApprovalMode';
import { AGENT_MODES_OWNER, BUILTIN_MODES } from './builtin';

export class ApprovalModes extends Context.Service<ApprovalModes, ModeRegistry>()('@runlith/agent/ApprovalModes') {}

export const builtinModeRegistry = (): ModeRegistry => makeModeRegistry({ owner: AGENT_MODES_OWNER, seed: BUILTIN_MODES });

export const approvalModesLayer = Layer.sync(ApprovalModes, builtinModeRegistry);

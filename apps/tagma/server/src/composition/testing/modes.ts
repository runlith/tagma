import { modeOfLookup } from '@runlith/agent/modes/ApprovalMode';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';

const builtins = builtinModeRegistry();

export const builtinMode = (id: string) => modeOfLookup(builtins, id);

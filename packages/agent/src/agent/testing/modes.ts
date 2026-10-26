import { builtinModes } from '../../modes/builtin';
import { modeOfLookup, type ModeOf } from '../../modes/ApprovalMode';

export const builtinMode = (id: string): ModeOf => modeOfLookup(builtinModes, id);

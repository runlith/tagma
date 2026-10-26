import { pairsOf } from '../../platform/contract/service/routed.js';
import { GUEST_ROUTED } from './guest.js';
import { IMPORT_ROUTED } from './import.js';
import { TREE_ROUTED } from './tree.js';

export const SANDBOX_PAIRS = pairsOf({ ...GUEST_ROUTED, ...TREE_ROUTED, ...IMPORT_ROUTED });

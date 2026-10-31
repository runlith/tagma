import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { entryKinds as readerOver } from '../entryKinds.js';
import { MODULES } from '../developer/modules.js';
import { rested } from '../developer/rested.js';

export const entryKinds = (): ThreadEntryReader => readerOver(MODULES, rested);

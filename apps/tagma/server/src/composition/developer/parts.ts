import { serverParts } from '../build.js';
import { BINDINGS } from './bindings.js';
import { MODULES } from './modules.js';
import { rested } from './rested.js';

export const PARTS = serverParts({ modules: MODULES, bindings: BINDINGS, rested });

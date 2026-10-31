/// <reference types="bun" />

import { serveRestedFolds } from '../../native-harness/transcript/foldServer.js';
import { entryKinds } from '../entryKinds.js';
import { MODULES } from './modules.js';
import { rested } from './rested.js';

serveRestedFolds(entryKinds(MODULES, rested));

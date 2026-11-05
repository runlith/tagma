/// <reference types="bun" />

import { serveRestedFolds } from '../../../native-harness/transcript/foldServer.js';
import { entryKinds } from '../../entryKinds.js';
import { RIG_MODULES } from './journalRig.js';

serveRestedFolds(entryKinds(RIG_MODULES, () => new Worker(new URL('./journalRig.worker.ts', import.meta.url), { type: 'module' })));

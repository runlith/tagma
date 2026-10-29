/// <reference types="bun" />

import { serveRestedFolds } from '../native-harness/transcript/foldServer.js';
import { entryKinds } from './entryKinds.js';

serveRestedFolds(entryKinds());

/// <reference types="bun" />

import { serveRestedFolds } from '../transcript/foldServer.js';
import { coreKinds } from './readers.js';

serveRestedFolds(coreKinds());

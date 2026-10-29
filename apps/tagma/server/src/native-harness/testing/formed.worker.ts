/// <reference types="bun" />

import { serveRestedFolds } from '../transcript/foldServer.js';
import { formedKinds } from './readers.js';

serveRestedFolds(formedKinds());

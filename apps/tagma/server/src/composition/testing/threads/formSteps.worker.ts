/// <reference types="bun" />

import { serveRestedFolds } from '../../../native-harness/transcript/foldServer.js';
import { datedKinds } from './formStepsReader.js';

serveRestedFolds(datedKinds());

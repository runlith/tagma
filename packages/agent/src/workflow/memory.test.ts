import { Effect } from 'effect';
import { describeWorkflowRunStoragePort } from './conformance';
import { makeWorkflowRuns } from './memory';

describeWorkflowRunStoragePort('InMemory', () => Effect.sync(makeWorkflowRuns));

import type { ThreadBornOf } from '@runlith/agent/protocol/birth';
import { Context, type Effect } from 'effect';

import type { WorkflowRun } from '@runlith/agent/workflow/run';
import type { WorkflowCatalog } from '@runlith/agent/workflow/library';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { ThreadBirths } from '../../../threads/birth/acts.js';

export class Workflows extends Context.Service<
  Workflows,
  {
    list(projectId: number): Effect.Effect<WorkflowCatalog, HarnessFailure>;
    start(input: {
      projectId: number;
      workflow: string;
      input: Record<string, unknown>;
      scopeBlockUuid?: string;
      createdBySessionId: number | null;
      askedBy?: string;
      bornOf?: ThreadBornOf;
    }): Effect.Effect<{ runId: string; threadId: string }, HarnessFailure, ThreadBirths>;
    runsOf(projectId: number): Effect.Effect<readonly WorkflowRun[], HarnessFailure>;
  }
>()('tagma/native-harness/Workflows') {}

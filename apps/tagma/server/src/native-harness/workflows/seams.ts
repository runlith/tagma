import type { WorkflowSeam } from '@runlith/agent/workflow/WorkflowConfig';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { Context, Effect } from 'effect';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { Review } from '../../graph/contract/service/work.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { blockLine } from '../../graph/voice/lines.js';
import { blockName } from '../../graph/contract/wire/references.js';

export function workflowSeams(options: {
  readonly records: ThreadRecords['Service'];
  readonly graphFor: (projectId: number) => Effect.Effect<Context.Context<GraphServices | GraphStore>, GateRefusal>;
}): Readonly<Record<string, WorkflowSeam>> {
  return {
    'standing-proposals': Effect.fnUntraced(function* (input) {
      const scope = input.run.input.scope;
      if (typeof scope !== 'string') {
        return yield* Effect.fail(broke(`${input.seam} needs the scope this run was given as a block name.`));
      }
      const projectId = yield* crossing(options.records.projectOf(input.run.thread));
      if (projectId === undefined) {
        return yield* Effect.fail(broke(`Workflow run ${input.run.id} has no project to read.`));
      }
      const graph = yield* crossing(options.graphFor(projectId));
      const vocabulary = yield* crossing(Context.get(graph, Tags).reader(projectId));
      const scopeId = yield* crossing(Context.get(graph, BlockNames).idOfName(scope));
      const standing = yield* crossing(Context.get(graph, Review).proposals({ projectId, scopeId }));
      return { standing: standing.map((row) => blockLine(vocabulary(), { ...row, name: blockName(row.uuid) })) };
    }),
  };
}

const broke = (reason: string) => new ThreadCallBroke({ cause: new Error(reason) });

function crossing<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, ThreadCallBroke> {
  return Effect.mapError(work, (cause) => new ThreadCallBroke({ cause }));
}

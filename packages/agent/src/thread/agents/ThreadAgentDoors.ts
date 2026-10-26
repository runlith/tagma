import { Context, Effect, Layer } from 'effect';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { ThreadDoorRequest, ThreadToolContextInput } from './ThreadAgent';
import { ThreadAgents } from './ThreadAgents';
import { ModeLaw } from '../../modes/ModeLaw';
import type { ThreadSources } from './supply';
import { ThreadToolOutputVault, type ThreadToolOutputScopeFaces } from '../ThreadPorts';
import type { ThreadBorderFailed } from '../ThreadBorder';

export type ThreadToolExecutionContext = {
  readonly catalog: ToolCatalog;
  readonly toolOutputs: ThreadToolOutputScopeFaces;
};

export type ThreadToolExecutionInput = ThreadToolContextInput & {
  readonly sources: ThreadSources;
};

export class ThreadAgentDoors extends Context.Service<
  ThreadAgentDoors,
  {
    toolDoor(input: ThreadDoorRequest): Effect.Effect<AgentToolDoor, ThreadBorderFailed>;
    toolContext(input: ThreadToolExecutionInput): Effect.Effect<ThreadToolExecutionContext, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadAgentDoors') {}

export const threadAgentDoorsLayer = Layer.effect(
  ThreadAgentDoors,
  Effect.gen(function* () {
    const agents = yield* ThreadAgents;
    const vault = yield* ThreadToolOutputVault;
    const laws = yield* ModeLaw;
    return ThreadAgentDoors.of({
      toolDoor: (input) =>
        Effect.flatMap(agents.get(input.thread.agentId), (agent) =>
          agent.toolDoor({ ...input, modeOf: laws.of(input.thread.id, input.thread.authority.mode) }),
        ),
      toolContext: Effect.fnUntraced(function* (input) {
        const agent = yield* agents.get(input.thread.agentId);
        const outputScope = vault.scope({
          threadId: input.thread.id,
          ownerId: input.thread.ownerId,
          runId: input.run.id,
        });
        const catalog = yield* agent
          .toolCatalog({
            thread: input.thread,
            run: input.run,
            admitted: input.admitted ?? null,
            supply: { sources: input.sources, outputTools: outputScope.tools },
          })
          .pipe(Effect.tapError(() => outputScope.dispose().pipe(Effect.ignore)));
        return { catalog, toolOutputs: outputScope };
      }),
    });
  }),
);

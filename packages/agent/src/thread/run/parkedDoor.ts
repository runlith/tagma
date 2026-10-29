import { Cause, Effect, Exit } from 'effect';
import type { CallHooks } from '../../agent/AgentCalls';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import type { ToolGuides } from '../../agent/door/ToolRules';
import { ToolSettlements } from '../../agent/ToolSettlements';
import type { AgentToolResolution } from '../../agent/door/types';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { admittedToolSources } from '../agents/admittedToolSources';
import { ThreadAgentDoors, type ThreadToolExecutionContext } from '../agents/ThreadAgentDoors';
import { ThreadAgents } from '../agents/ThreadAgents';
import { readThreadRunStepsTaken } from '../events';
import type { ThreadRow, ThreadRunRow } from '../rows';
import { ThreadToolRegistry } from '../ThreadPorts';
import { transitionDeps } from '../transition/kernel';
import type { RunResumption } from './RunExecution';
import { priorToolRecords } from './ThreadQuestion';
import { ThreadRunContexts } from './ThreadRunContexts';

export type ParkedDoor = {
  readonly transcript: readonly ThreadTranscriptEntry[];
  readonly toolContext: ThreadToolExecutionContext;
  readonly door: AgentToolDoor;
};

export const disposed = (toolContext: ThreadToolExecutionContext): Effect.Effect<void> =>
  toolContext.toolOutputs.dispose().pipe(
    Effect.exit,
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit) ? Effect.void : Effect.logWarning('the tool outputs of a parked call did not dispose', Cause.pretty(exit.cause)),
    ),
  );

export type ParkedDoors = Effect.Success<typeof makeParkedDoors>;

export const makeParkedDoors = Effect.gen(function* () {
  const { store, log, kinds } = yield* transitionDeps;
  const contexts = yield* ThreadRunContexts;
  const agents = yield* ThreadAgents;
  const toolSources = yield* ThreadToolRegistry;
  const doors = yield* ThreadAgentDoors;
  const settlements = yield* ToolSettlements;
  return Effect.fnUntraced(function* (
    thread: ThreadRow,
    run: ThreadRunRow,
    resolutions: readonly AgentToolResolution[],
    interruptible: RunResumption['interruptible'],
    callHooks?: (toolContext: ThreadToolExecutionContext) => CallHooks,
    onGuides?: ToolGuides,
  ) {
    const admitted = (yield* interruptible(contexts.read({ id: run.id, threadId: thread.id }))).admitted?.record ?? null;
    const transcript = yield* interruptible(store.entriesOfRun(thread.id, run.id));
    const view = { ...thread, transcript };
    const sources = yield* interruptible(admittedToolSources(agents, toolSources, { thread, run }));
    const toolContext = yield* interruptible(doors.toolContext({ thread: view, run, sources, admitted }));
    const door = yield* interruptible(
      Effect.gen(function* () {
        const stepsTaken = yield* readThreadRunStepsTaken(log, kinds, { id: run.id, threadId: thread.id });
        return yield* doors.toolDoor({
          thread: view,
          run,
          admitted,
          stepsTaken: Math.max(0, stepsTaken - 1),
          priorTools: priorToolRecords(transcript, run.id),
          toolOutputs: toolContext.toolOutputs,
          resolutions,
          callHooks: callHooks?.(toolContext),
          onGuides,
        });
      }).pipe(Effect.provideService(ToolSettlements, settlements)),
    ).pipe(Effect.onError(() => disposed(toolContext)));
    return { transcript, toolContext, door } satisfies ParkedDoor;
  });
});

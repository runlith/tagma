import { Effect } from 'effect';
import { makeAgentCalls } from '../../agent/AgentCalls';
import type { AgentToolOutputs } from '../../agent/ToolOutput';
import { openToolDoor, ToolJudge } from '../../agent/door/openToolDoor';
import type { AgentToolResolution } from '../../agent/door/types';
import type { AgentRuntimePolicy } from '../../agent/policy/AgentRuntimePolicy';
import { unthreadedCaller } from '../../agent/testing/caller';
import { builtinMode } from '../../agent/testing/modes';

export const questionDoor = Effect.gen(function* () {
  const calls = yield* makeAgentCalls({ history: 2 });
  const open = (
    input: {
      readonly mode?: 'trust' | 'review';
      readonly resolutions?: readonly AgentToolResolution[];
      readonly policy?: AgentRuntimePolicy<{}>;
      readonly outputs?: AgentToolOutputs;
    } = {},
  ) =>
    openToolDoor(
      'run-1',
      unthreadedCaller,
      {},
      new ToolJudge(builtinMode(input.mode ?? 'review')),
      undefined,
      input.policy,
      undefined,
      input.outputs,
      calls,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      input.resolutions,
    );
  return { calls, open };
});

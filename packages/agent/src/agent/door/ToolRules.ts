import type { Effect } from 'effect';
import type { AgentRuleFailed } from '../AgentFailure';
import type { AgentDirective, AgentEvaluationFacts, AgentRuntimePolicy } from '../policy/AgentRuntimePolicy';
import type { AgentHook } from '../contracts';
import type { ToolRun } from './ToolRun';

export type ToolGuides = (
  directives: readonly AgentDirective[],
  context: { hook: AgentHook; toolName: string; toolCallId: string },
) => void;

export type ToolRules<TCtx> = ReturnType<typeof makeToolRules<TCtx>>;

export const makeToolRules = <TCtx>({
  run,
  policy,
  guides,
}: {
  readonly run: ToolRun<TCtx>;
  readonly policy: AgentRuntimePolicy<TCtx>;
  readonly guides: ToolGuides | undefined;
}) => ({
  evaluate: (facts: AgentEvaluationFacts, ctx: TCtx = run.ctx): Effect.Effect<readonly AgentDirective[], AgentRuleFailed> =>
    policy.evaluate({
      ...ctx,
      runId: run.runId,
      run: run.runState,
      ...facts,
    }),

  guide: (directives: readonly AgentDirective[], context: { hook: AgentHook; toolName: string; toolCallId: string }): void => {
    guides?.(directives, context);
  },
});

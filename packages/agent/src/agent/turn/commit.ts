import { Usage, sumUsage } from '@runlith/llm/schema/events';
import type { AgentRunState } from '../AgentRunState';
import type { AgentStep } from '../AgentStep';

export type AgentStepCommitInput = {
  readonly runState: AgentRunState;
  readonly steps: AgentStep[];
  readonly step: AgentStep;
};

export function commitStep(input: AgentStepCommitInput): void {
  input.runState.commitStep(input.step);
  input.steps.push(input.step);
}

export function totalAgentUsage(steps: readonly AgentStep[]): Usage {
  let total = new Usage({});
  for (const step of steps) {
    if (!step.usage) continue;
    total = sumUsage(total, step.usage);
  }
  return total;
}

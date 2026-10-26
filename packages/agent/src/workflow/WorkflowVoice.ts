import { agentSignalMarkup } from '../agent/AgentSignal';

export const WORKFLOW_INPUT_MARKUP = 'workflow-input';

export function workflowTask(task: string, bound: Readonly<Record<string, unknown>>): string {
  const named = Object.entries(bound);
  if (named.length === 0) return task;
  const text = named.map(([name, value]) => `${name}: ${asText(value)}`).join('\n');
  return `${task}\n\n${agentSignalMarkup({ type: WORKFLOW_INPUT_MARKUP, text })}`;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

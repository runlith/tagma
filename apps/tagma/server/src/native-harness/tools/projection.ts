import { type Tool, toolFieldNames } from '@runlith/agent/tool';
import type { ToolDisplay } from '@runlith/agent/tool/display';

export function withCalled<TInput>(tool: Tool, called: (input: Partial<TInput>) => ToolDisplay): Tool {
  const fields = toolFieldNames(tool);
  return {
    ...tool,
    display: {
      streamFields: fields === null ? null : [...fields],
      project: (input) => called(input as Partial<TInput>),
    },
  };
}

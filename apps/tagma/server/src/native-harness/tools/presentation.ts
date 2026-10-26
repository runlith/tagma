import { COLLABORATION_WORDS } from '@runlith/agent/collaboration/words';
import { SKILL_WORDS } from '@runlith/agent/skillWords';
import type { ToolWords } from '@runlith/agent/tool/words';
import { WORKSPACE_WORDS } from '@runlith/agent-tools/words';
import { mcpToolNamed } from '@runlith/mcp/identity';
import { RETRIEVAL_WORDS } from './outputWords.js';

const DECLARED: Readonly<Record<string, ToolWords | undefined>> = Object.assign(
  Object.create(null) as Record<string, ToolWords>,
  WORKSPACE_WORDS,
  SKILL_WORDS,
  RETRIEVAL_WORDS,
  COLLABORATION_WORDS,
);

export function toolPresentation(toolName: string, operationWords: (toolName: string) => ToolWords | undefined): ToolWords {
  const operation = operationWords(toolName);
  if (operation !== undefined) return operation;
  const server = mcpToolNamed(toolName);
  if (server !== null) {
    return {
      running: `Calling ${server.tool} on ${server.server}`,
      done: `Called ${server.tool} on ${server.server}`,
    };
  }
  const known = DECLARED[toolName];
  if (known !== undefined) return known;
  const words = toolName.replaceAll('_', ' ');
  return { running: words, done: words };
}

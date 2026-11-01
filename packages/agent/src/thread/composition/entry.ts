import type { JsonSchema } from '@runlith/llm/schema/ids';
import type { Message } from '@runlith/llm/schema/messages';
import { revealedDeferredToolNames } from '../../agent/AgentDeferredTools';
import { wireToolDefinitions } from '../../agent/ModelRequests';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { ThreadCompositionEntry } from '../../transcript/entries';
import { compositionEntryId } from '../../transcript/entryNames';

export type ToolChars = { readonly name: string; readonly chars: number; readonly deferred: boolean };

type ComposedTool = ThreadCompositionEntry['tools']['each'][number];

const charsOf = (name: string, description: string, inputSchema: JsonSchema): number =>
  JSON.stringify({ name, description, input_schema: inputSchema }).length;

export function toolChars(catalog: ToolCatalog): readonly ToolChars[] {
  return wireToolDefinitions(catalog, undefined).map((tool) => ({
    name: tool.name,
    chars: charsOf(tool.name, tool.description, tool.inputSchema),
    deferred: tool.deferred === true,
  }));
}

export function catalogTools(catalog: ToolCatalog, history: readonly Message[]): readonly ComposedTool[] {
  const revealed = revealedDeferredToolNames(catalog, history);
  return toolChars(catalog).map((tool) => ({
    name: tool.name,
    chars: tool.chars,
    hidden: tool.deferred && !revealed.has(tool.name) ? (true as const) : undefined,
  }));
}

export function servedTools(
  tools: readonly { readonly name: string; readonly description: string; readonly inputSchema: JsonSchema }[],
): readonly ComposedTool[] {
  return tools.map((tool) => ({ name: tool.name, chars: charsOf(tool.name, tool.description, tool.inputSchema) }));
}

export function compositionEntry(
  runId: string,
  instructions: string,
  each: readonly ComposedTool[],
  context: Message | null,
  history: readonly Message[],
): ThreadCompositionEntry {
  const content = context?.content;
  const contextChars = content === undefined ? null : (typeof content === 'string' ? content : JSON.stringify(content)).length;
  return {
    type: 'composition',
    id: compositionEntryId(runId),
    runId,
    occurredAt: new Date().toISOString(),
    opening: history.some((message) => message.role === 'assistant') ? undefined : true,
    system: { chars: instructions.length },
    context: contextChars === null ? null : { chars: contextChars },
    tools: { count: each.length, chars: each.reduce((sum, tool) => sum + tool.chars, 0), each },
  };
}

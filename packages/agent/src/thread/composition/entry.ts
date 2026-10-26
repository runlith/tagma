import type { Message } from '@runlith/llm/schema/messages';
import { revealedDeferredToolNames } from '../../agent/AgentDeferredTools';
import { wireToolDefinitions } from '../../agent/ModelRequests';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { ThreadCompositionEntry } from '../../transcript/entries';
import { compositionEntryId } from '../../transcript/entryNames';

export type ToolChars = { readonly name: string; readonly chars: number; readonly deferred: boolean };

export function toolChars(catalog: ToolCatalog): readonly ToolChars[] {
  return wireToolDefinitions(catalog, undefined).map((tool) => ({
    name: tool.name,
    chars: JSON.stringify({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }).length,
    deferred: tool.deferred === true,
  }));
}

export function compositionEntry(
  runId: string,
  instructions: string,
  catalog: ToolCatalog,
  context: Message | null,
  history: readonly Message[],
): ThreadCompositionEntry {
  const revealed = revealedDeferredToolNames(catalog, history);
  const each = toolChars(catalog).map((tool) => ({
    name: tool.name,
    chars: tool.chars,
    hidden: tool.deferred && !revealed.has(tool.name) ? (true as const) : undefined,
  }));
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

import { LLMError } from '../../schema/errors';
import { LLMEvent, type ToolCall } from '../../schema/events';
import type { ProviderMetadata } from '../../schema/ids';
import { failureOf, toolInput, type ToolAccumulator } from '../shared';

type StreamKey = string | number;

export interface PendingTool extends ToolAccumulator {
  readonly providerExecuted?: boolean;
  readonly providerMetadata?: ProviderMetadata;
}

export type State<K extends StreamKey> = Partial<Record<K, PendingTool>>;

export interface AppendOutcome<K extends StreamKey> {
  readonly tools: State<K>;
  readonly tool: PendingTool;
  readonly events: ReadonlyArray<LLMEvent>;
}

export const empty = <K extends StreamKey>(): State<K> => ({});

const withTool = <K extends StreamKey>(tools: State<K>, key: K, tool: PendingTool): State<K> => {
  tools[key] = tool;
  return tools;
};

const withoutTool = <K extends StreamKey>(tools: State<K>, key: K): State<K> => {
  delete tools[key];
  return tools;
};

const inputStart = (tool: PendingTool) =>
  LLMEvent.toolInputStart({
    id: tool.id,
    name: tool.name,
    providerMetadata: tool.providerMetadata,
  });

const inputDelta = (tool: PendingTool, text: string) =>
  LLMEvent.toolInputDelta({
    id: tool.id,
    name: tool.name,
    text,
  });

const toolCall = (tool: PendingTool, inputOverride?: string): ToolCall => {
  const { input, unparsed } = toolInput(inputOverride ?? tool.input.join(''));
  return LLMEvent.toolCall({
    id: tool.id,
    name: tool.name,
    input,
    unparsed,
    providerExecuted: tool.providerExecuted ? true : undefined,
    providerMetadata: tool.providerMetadata,
  });
};

const toolEnd = (tool: PendingTool, inputOverride?: string): readonly LLMEvent[] => [
  LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
  toolCall(tool, inputOverride),
];

const appendTool = <K extends StreamKey>(tools: State<K>, key: K, tool: PendingTool, text: string): AppendOutcome<K> => {
  const events: LLMEvent[] = [];
  if (!tools[key]) events.push(inputStart(tool));
  if (text.length > 0) events.push(inputDelta(tool, text));
  return {
    tools: withTool(tools, key, tool),
    tool,
    events,
  };
};

export const isError = <K extends StreamKey>(result: AppendOutcome<K> | LLMError): result is LLMError => result instanceof LLMError;

export const start = <K extends StreamKey>(tools: State<K>, key: K, tool: Omit<PendingTool, 'input'> & { readonly input?: string }) =>
  withTool(tools, key, { ...tool, input: tool.input ? [tool.input] : [] });

export const appendOrStart = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  delta: { readonly id?: string; readonly name?: string; readonly text: string },
  missingToolMessage: string,
): AppendOutcome<K> | LLMError => {
  const current = tools[key];
  const id = delta.id ?? current?.id;
  const name = delta.name ?? current?.name;
  if (!id || !name) return failureOf(undefined, { route, message: missingToolMessage, family: 'invalid-output' });

  if (current && delta.text.length === 0 && current.id === id && current.name === name) return { tools, tool: current, events: [] };
  const tool = {
    id,
    name,
    input: current?.input ?? [],
    providerExecuted: current?.providerExecuted,
    providerMetadata: current?.providerMetadata,
  };
  if (delta.text.length > 0) tool.input.push(delta.text);
  return appendTool(tools, key, tool, delta.text);
};

export const appendExisting = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  text: string,
  missingToolMessage: string,
): AppendOutcome<K> | LLMError => {
  const current = tools[key];
  if (!current) return failureOf(undefined, { route, message: missingToolMessage, family: 'invalid-output' });
  if (text.length === 0) return { tools, tool: current, events: [] };
  current.input.push(text);
  return appendTool(tools, key, current, text);
};

export type FinishOutcome<K extends StreamKey> = { readonly tools: State<K>; readonly events?: readonly LLMEvent[] };

export const finish = <K extends StreamKey>(tools: State<K>, key: K): FinishOutcome<K> => {
  const tool = tools[key];
  if (!tool) return { tools };
  return { tools: withoutTool(tools, key), events: toolEnd(tool) };
};

export const finishWithInput = <K extends StreamKey>(tools: State<K>, key: K, input: string): FinishOutcome<K> => {
  const tool = tools[key];
  if (!tool) return { tools };
  return { tools: withoutTool(tools, key), events: toolEnd(tool, input) };
};

export const finishAll = <K extends StreamKey>(tools: State<K>): { readonly tools: State<K>; readonly events: readonly LLMEvent[] } => ({
  tools: empty<K>(),
  events: Object.values<PendingTool | undefined>(tools).flatMap((tool) => (tool === undefined ? [] : toolEnd(tool))),
});

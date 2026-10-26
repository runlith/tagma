import { LLMResponse } from '@runlith/llm/schema/events';
import { Message, ToolResultPart, type ContentPart } from '@runlith/llm/schema/messages';
import type { AgentStep } from '../AgentStep';
import type { AgentToolOutcome } from './tools';

export type AgentStepCall = {
  readonly account?: string;
  readonly activity?: string;
};

export function foldStep(response: LLMResponse, outcomes: readonly AgentToolOutcome[], call: AgentStepCall): AgentStep {
  const outcomeParts = outcomes.map((outcome): ContentPart =>
    ToolResultPart.from({
      id: outcome.toolCallId,
      name: outcome.toolName,
      result: outcome.executed ? outcome.output : outcome.error,
      resultType: outcome.executed ? 'json' : 'error',
      durationMs: outcome.durationMs,
      retained: outcome.retained,
      providerMetadata: outcome.providerMetadata,
    }),
  );
  const content = [...response.message.content, ...outcomeParts];
  const callOrder = new Map<string, number>();
  for (const part of response.message.content) {
    if (part.type === 'tool-call' && !callOrder.has(part.id)) callOrder.set(part.id, callOrder.size);
  }
  const toolParts = [
    ...outcomes.map((outcome) =>
      ToolResultPart.from({
        id: outcome.toolCallId,
        name: outcome.toolName,
        result: outcome.modelOutput,
        durationMs: outcome.durationMs,
        retained: outcome.retained,
        providerMetadata: outcome.providerMetadata,
      }),
    ),
  ].sort((a, b) => {
    const aOrder = 'id' in a ? (callOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) : 0;
    const bOrder = 'id' in b ? (callOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) : 0;
    return aOrder - bOrder;
  });
  const origin = response.message.origin;
  const quota = response.events.findLast((event) => event.type === 'step-finish')?.quota;
  const stepMessages: Message[] = [
    response.message,
    ...(toolParts.length > 0 ? [Message.make({ role: 'tool', content: toolParts, origin: origin })] : []),
  ];
  const reasoning = response.reasoning;
  return {
    content,
    text: response.text,
    reasoningText: reasoning === '' ? undefined : reasoning,
    toolCalls: content.flatMap((part) =>
      part.type === 'tool-call' ? [{ toolCallId: part.id, toolName: part.name, input: part.input }] : [],
    ),
    toolResults: content.flatMap((part) =>
      part.type === 'tool-result' && part.result.type !== 'error'
        ? [{ toolCallId: part.id, toolName: part.name, output: part.result.value }]
        : [],
    ),
    usage: LLMResponse.usage(response),
    quota: quota,
    account: call.account,
    activity: call.activity,
    response: { messages: stepMessages },
  };
}

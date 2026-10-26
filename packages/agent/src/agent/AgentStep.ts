import type { ContentPart, Message } from '@runlith/llm/schema/messages';
import type { QuotaObservation } from '@runlith/llm/schema/quota';
import type { Usage } from '@runlith/llm/schema/events';

export type AgentStep = {
  readonly content: readonly ContentPart[];
  readonly text: string;
  readonly reasoningText: string | undefined;
  readonly toolCalls: readonly AgentStepToolCall[];
  readonly toolResults: readonly AgentStepToolResult[];
  readonly usage: Usage | undefined;
  readonly quota?: QuotaObservation;
  readonly account?: string;
  readonly activity?: string;
  readonly response?: { readonly messages?: readonly Message[] };
};

export type AgentStepToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
};

export type AgentStepToolResult = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
};

export type AgentStepIntent = {
  readonly stepNumber: number;
  readonly messages: readonly Message[];
  readonly calls: readonly AgentStepToolCall[];
};

export type AgentStopCondition = (input: { readonly steps: readonly AgentStep[] }) => boolean;

export type AgentOneStep = {
  readonly refusal: string;
};

export function stepLimit(steps: number): AgentStopCondition {
  return ({ steps: taken }) => taken.length >= steps;
}

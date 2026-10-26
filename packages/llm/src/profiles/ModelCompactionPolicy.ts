import type { LLMResponse } from '../llm/schema/events';
import type { Message } from '../llm/schema/messages';

export interface ModelCompactionPolicy {
  select(messages: readonly Message[], alreadyCovered: number): number | null;
  summary(response: LLMResponse): string;
}

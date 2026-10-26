import type { ThreadTranscript } from './rows';

export type ThreadPartOrdinals = { readonly text: number; readonly reasoning: number };

export function userMessageEntryId(runId: string): string {
  return `message:user:${runId}`;
}

export function threadPartOrdinals(runEntries: ThreadTranscript): ThreadPartOrdinals {
  let text = 0;
  let reasoning = 0;
  for (const entry of runEntries) {
    if (entry.type === 'message' && (entry as { role?: string }).role === 'assistant') text += 1;
    else if (entry.type === 'reasoning') reasoning += 1;
  }
  return { text, reasoning };
}

export function assistantMessageEntryId(runId: string, textIndex: number): string {
  return textIndex === 0 ? `assistant:${runId}` : `assistant:${runId}:text:${textIndex}`;
}

export function reasoningEntryId(runId: string, index: number): string {
  return index === 0 ? `reasoning:${runId}` : `reasoning:${runId}:${index}`;
}

export function toolEntryId(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

export function hostedToolEntryId(runId: string, toolCallId: string): string {
  return toolEntryId(`${runId}:${toolCallId}`);
}

export function spokenMessageEntryId(eventId: string): string {
  return `spoken:message:${eventId}`;
}

export function signalEntryId(signalId: string): string {
  return `transcript:signal:${signalId}`;
}

export function runEndEntryId(runId: string): string {
  return `run-end:${runId}`;
}

export function interruptionEntryId(runId: string): string {
  return `interruption:${runId}`;
}

export function retryEntryId(runId: string, stepNumber: number, attempt: number): string {
  return `retry:${runId}:${stepNumber}:${attempt}`;
}

export function recoveryEntryId(runId: string, adoptedAt: string): string {
  return `recovery:${runId}:${adoptedAt}`;
}

export function failureEntryId(runId: string): string {
  return `transcript:error:${runId}`;
}

export function systemPromptEntryId(runId: string): string {
  return `system-prompt:${runId}`;
}

export function compositionEntryId(runId: string): string {
  return `composition:${runId}`;
}

export function contextChangeEntryId(runId: string, requestId: string): string {
  return `context-change:${runId.length}:${runId}:${requestId}`;
}

export function compactionEntryId(runId: string, stepNumber?: number): string {
  return stepNumber === undefined ? `compaction:${runId}` : `compaction:${runId}:${stepNumber}`;
}

export function requestedCompactionEntryId(runId: string, stepNumber: number): string {
  return `compaction:${runId}:${stepNumber}:requested`;
}

export function questionEntryId(runId: string, toolCallIds: readonly string[]): string {
  return `transcript:question:${runId.length}:${runId}:${toolCallIds.map((id) => `${id.length}:${id}`).join(':')}`;
}

export function interactionQuestionEntryId(interactionKey: string): string {
  return `transcript:question:${interactionKey}`;
}

export function readyAnswersEntryId(runId: string, toolCallId: string): string {
  return `transcript:ready-answers:${runId}:${toolCallId}`;
}

import { createHash } from 'node:crypto';
import { parseThreadPendingInteraction, readableRowFact } from '@runlith/agent/thread/persisted';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { THREAD_TOOL_CANCEL_VALUE, THREAD_TOOL_CONFIRM_KIND, THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import type { ThreadInteractionPrompt } from '@runlith/agent/transcript/entries';
import type { ThreadAsk, ThreadAskOption } from '../contract/wire/list.js';

export const ASK_TEXT_CHARS = 1000;

export function cutText(text: string, limit: number): string {
  const chars = [...text];
  return chars.length > limit
    ? `${chars
        .slice(0, limit - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

export function askKey(kind: ThreadAsk['kind'], tools: readonly string[], text: string): string {
  const words = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(JSON.stringify([kind, [...tools].sort(), words]))
    .digest('hex')
    .slice(0, 32);
}

const readableAsk = (kinds: ThreadEntryReader, pending: unknown): ReturnType<typeof parseThreadPendingInteraction> =>
  readableRowFact(
    kinds,
    'A parked question',
    'a parked question this build cannot read leaves its list row without the question',
    () => parseThreadPendingInteraction(kinds, pending),
    null,
  );

export function standaloneAsk(kinds: ThreadEntryReader, pending: unknown): ThreadAsk | null {
  const parsed = readableAsk(kinds, pending);
  return parsed === null || parsed.action === undefined ? null : nativeAsk(kinds, pending, parsed.runId);
}

export function nativeAsk(kinds: ThreadEntryReader, pending: unknown, parkedRunId: string): ThreadAsk | null {
  const parsed = readableAsk(kinds, pending);
  if (parsed === null) return null;
  const entry = parsed;
  if (entry.status !== 'open' || entry.runId !== parkedRunId) return null;
  const first = entry.questions[0];
  if (first === undefined) return null;
  const kind = entry.questions.every((prompt) => prompt.kind === THREAD_TOOL_CONFIRM_KIND) ? 'confirm' : 'question';
  return {
    questionId: entry.questionId,
    text: cutText(first.prompt, ASK_TEXT_CHARS),
    kind,
    key: askKey(
      kind,
      entry.toolCalls.map((call) => call.toolName),
      first.prompt,
    ),
    askedAt: entry.occurredAt ?? null,
    options: kind === 'confirm' ? confirmOptions(entry.questions) : choiceOptions(entry.questions),
    approver: entry.approver,
    header: first.header === undefined ? undefined : cutText(first.header, ASK_TEXT_CHARS),
    deliveryUnknown: entry.deliveryUnknown === true ? true : undefined,
    deliveryNote: entry.deliveryNote === undefined ? undefined : cutText(entry.deliveryNote, ASK_TEXT_CHARS),
  };
}

const CONFIRM = [
  { label: 'Allow', value: THREAD_TOOL_CONFIRM_VALUE },
  { label: 'Deny', value: THREAD_TOOL_CANCEL_VALUE },
] as const;

export type TapChoice = { readonly label: string; readonly value: string };

export function tapOptions(promptId: string, prompt: string, choices: readonly TapChoice[]): readonly ThreadAskOption[] {
  if ([...prompt].length > ASK_TEXT_CHARS) return [];
  return choices.map((choice) => ({ label: choice.label, answers: [{ questionId: promptId, values: [choice.value] }] }));
}

function confirmOptions(prompts: readonly ThreadInteractionPrompt[]): readonly ThreadAskOption[] {
  const [prompt, ...rest] = prompts;
  if (prompt === undefined || rest.length > 0) return [];
  const offered = new Set((prompt.options ?? []).map((option) => option.value));
  if (!CONFIRM.every((side) => offered.has(side.value))) return [];
  return tapOptions(prompt.id, prompt.prompt, CONFIRM);
}

function choiceOptions(prompts: readonly ThreadInteractionPrompt[]): readonly ThreadAskOption[] {
  const [prompt, ...rest] = prompts;
  if (prompt === undefined || rest.length > 0 || prompt.allowMultiple === true || prompt.secret === true) return [];
  return tapOptions(prompt.id, prompt.prompt, prompt.options ?? []);
}

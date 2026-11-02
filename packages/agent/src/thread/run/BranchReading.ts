import { Effect } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import { measuredWeight } from '../compaction/calibration';
import { estimateThreadTokens } from '../compaction/measurement';
import { measureMessages } from '../compaction/ThreadRequestMeter';
import { occupiedTokens } from '../compaction/limit';
import type { ThreadCallBroke } from '../ThreadBorder';
import type { ThreadContextReading, ThreadHistory } from '../rows';

type BranchReadingInput = {
  readonly reading: ThreadContextReading | null;
  readonly source: ThreadHistory;
  readonly carried: ThreadHistory;
  readonly sourcePrompt: string | null;
  readonly promptDropped: boolean;
};

export const branchReading = Effect.fnUntraced(function* (
  input: BranchReadingInput,
): Effect.fn.Return<ThreadContextReading | null, ThreadCallBroke> {
  const { reading, source, carried } = input;
  if (reading === null || carried.length === 0) return null;
  const kept = new Set<Message>(carried);
  const removed = source.flatMap((message, at) => (kept.has(message) ? [] : [at]));
  if (removed.length === 0 && !input.promptDropped) return reading;
  const measured = occupiedTokens(reading.usage);
  if (reading.stale || measured === null) return reading;
  const covered = Math.min(source.length, reading.footprint?.messages ?? source.length);
  const sizes = yield* measureMessages(source.slice(0, covered));
  const priced = (at: number) => sizes[at]?.tokens ?? estimateThreadTokens(source[at]);
  const prompt = input.sourcePrompt === null ? 0 : estimateThreadTokens(input.sourcePrompt);
  let coveredRaw = prompt;
  for (let at = 0; at < covered; at += 1) coveredRaw += priced(at);
  const weight = measuredWeight({ measured, covered: coveredRaw, estimated: 0 }) ?? 1;
  const gone = removed.reduce((sum, at) => sum + (at < covered ? priced(at) : 0), input.promptDropped ? prompt : 0);
  const tokens = Math.max(0, Math.round(measured - weight * gone));
  const { footprint: _footprint, historyMessages: _historyMessages, ...held } = reading;
  return { ...held, usage: Usage.from({ inputTokens: tokens, totalTokens: tokens }) };
});

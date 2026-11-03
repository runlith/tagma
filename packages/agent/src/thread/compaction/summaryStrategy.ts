import { Effect } from 'effect';
import { isContextOverflowFailure } from '@runlith/llm/provider-error';
import { LLMResponse } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import type { ModelRequest } from '../../agent/modelPort';
import type { CompactionModels } from './CompactionModels';
import { ThreadSummaryFailedError } from '../storage/compaction';
import { estimateThreadTokens } from './measurement';
import { previousThreadCompactionBoundary } from './prefix';
import { serializeThreadMessage } from './segmentText';
import type { ThreadCompactionPasses, ThreadCompactionSegment, ThreadCompactionStrategy, ThreadCompactionSummary } from './strategy';

export type ThreadCompactionPrompt = {
  readonly instructions: string;
  readonly template: string;
};

const RETAINED_TOKENS_PER_MESSAGE = 12;
const RETAINED_FLOOR_CAP = 400;
function retainedFloorTokens(coveredMessageCount: number): number {
  return Math.min(RETAINED_FLOOR_CAP, coveredMessageCount * RETAINED_TOKENS_PER_MESSAGE);
}

export type ThreadSummaryStrategyInput = {
  readonly models: CompactionModels;
  readonly prompt: ThreadCompactionPrompt;
};

export interface ThreadSummaryStrategy extends ThreadCompactionStrategy {
  summarize(segment: ThreadCompactionSegment): Effect.Effect<ThreadCompactionSummary, ThreadSummaryFailedError>;
  passes(segment: ThreadCompactionSegment): ThreadCompactionPasses;
}

export function makeThreadSummaryStrategy({ models, prompt }: ThreadSummaryStrategyInput): ThreadSummaryStrategy {
  const requestOf = (segment: ThreadCompactionSegment): ModelRequest =>
    models.request({
      ownerId: segment.ownerId,
      runId: segment.runId,
      account: segment.account,
      cacheGroup: segment.cacheGroup,
      provider: segment.provider,
      model: segment.model,
      reasoning: segment.reasoning,
      switches: segment.switches,
      instructions: prompt.instructions,
      reasoningOutput: false,
      parallelToolCalls: false,
      cache: 'none',
      stallMs: segment.stallMs,
    });
  return {
    passes: (segment) => {
      const request = requestOf(segment);
      const limit = segment.usableTokens(request.plannedOutputTokens);
      const fixed = fixedTokens(request);
      const sized = sizedSegment(segment.messages);
      const summaryChars = request.plannedOutputTokens * 4 + 1;
      const boundaries: number[] = [];
      let inputTokens = 0;
      let from = segment.alreadyCovered;
      let priorChars = segment.priorSummary ? segment.priorSummary.length : 0;
      while (from < segment.coveredMessageCount) {
        const frame = frameLength(priorChars, prompt.template, segment.keep);
        const cut = fittingCut(segment.messages, sized, from, segment.coveredMessageCount, frame, limit - fixed);
        if (cut === null) return { boundaries: null, inputTokens };
        inputTokens += fixed + charTokens(frame + bodyLength(sized, from, cut));
        boundaries.push(cut);
        from = cut;
        priorChars = summaryChars;
      }
      return { boundaries, inputTokens };
    },
    summarize: Effect.fnUntraced(function* (segment) {
      const request = requestOf(segment);
      const inputTokenLimit = segment.usableTokens(request.plannedOutputTokens);
      const fixedRequestTokens = fixedTokens(request);
      const select = (coveredMessageCount: number) =>
        selectThreadCompactionPrompt({
          messages: segment.messages,
          alreadyCovered: segment.alreadyCovered,
          coveredMessageCount,
          priorSummary: segment.priorSummary,
          inputTokenLimit,
          fixedRequestTokens,
          template: prompt.template,
          keep: segment.keep,
        });
      const noFit = (cause: unknown) =>
        new ThreadSummaryFailedError(
          segment,
          'no-fit',
          cause === null ? 'no model-message prefix fits the summary request.' : messageOf(cause),
          cause,
        );
      const summarize = (selected: CompactionPromptSelection): Effect.Effect<ThreadCompactionSummary, ThreadSummaryFailedError> =>
        request.text({ messages: [Message.user(selected.prompt)] }).pipe(
          Effect.matchEffect({
            onSuccess: (response) => summaryOf(segment, request, selected.coveredMessageCount, response),
            onFailure: (failure) => {
              if (!isContextOverflowFailure(failure))
                return Effect.fail(new ThreadSummaryFailedError(segment, 'model', messageOf(failure), failure));
              const previous = previousThreadCompactionBoundary(segment.messages, segment.alreadyCovered, selected.coveredMessageCount);
              const next = previous === null ? null : select(previous);
              return next === null ? Effect.fail(noFit(failure)) : summarize(next);
            },
          }),
        );
      const selected = select(segment.coveredMessageCount);
      return yield* selected === null ? Effect.fail(noFit(null)) : summarize(selected);
    }),
  };
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function summaryOf(
  segment: ThreadCompactionSegment,
  request: ModelRequest,
  coveredMessageCount: number,
  response: LLMResponse,
): Effect.Effect<ThreadCompactionSummary, ThreadSummaryFailedError> {
  const broken = (reason: ThreadSummaryFailedError['reason'], detail: string) =>
    Effect.fail(new ThreadSummaryFailedError(segment, reason, detail));
  if (response.finishReason !== 'stop') return broken('unfinished', `the model did not finish (finish reason: ${response.finishReason}).`);
  const summary = response.text.trim();
  if (!summary) return broken('empty', 'the model produced an empty summary.');
  const tokens = estimateThreadTokens(summary);
  if (tokens > request.plannedOutputTokens) return broken('over-budget', 'the summary exceeded its output budget.');
  if (tokens < retainedFloorTokens(coveredMessageCount)) {
    return broken('too-short', `the summary kept too little of ${coveredMessageCount} messages.`);
  }
  const account = request.signedAccount?.();
  return Effect.succeed({
    coveredMessageCount,
    summary,
    usage: LLMResponse.usage(response) ?? null,
    account: account,
  });
}

export type CompactionPromptInput = {
  readonly messages: readonly Message[];
  readonly alreadyCovered: number;
  readonly coveredMessageCount: number;
  readonly priorSummary: string | null;
  readonly inputTokenLimit: number;
  readonly fixedRequestTokens: number;
  readonly template: string;
  readonly keep?: string;
};

export type CompactionPromptSelection = { readonly coveredMessageCount: number; readonly prompt: string };

export function selectThreadCompactionPrompt(input: CompactionPromptInput): CompactionPromptSelection | null {
  const sized = sizedSegment(input.messages);
  const frame = frameLength(input.priorSummary ? input.priorSummary.length : 0, input.template, input.keep);
  const cut = fittingCut(
    input.messages,
    sized,
    input.alreadyCovered,
    input.coveredMessageCount,
    frame,
    input.inputTokenLimit - input.fixedRequestTokens,
  );
  if (cut === null) return null;
  return {
    coveredMessageCount: cut,
    prompt: threadCompactionPrompt(
      serialized(input.messages).texts.slice(input.alreadyCovered, cut),
      input.priorSummary,
      input.template,
      input.keep,
    ),
  };
}

const PRIOR_OPEN = 'Update the prior anchored state using the new thread segment.\n\n<prior-state>\n';
const PRIOR_CLOSE = '\n</prior-state>';
const FRESH = 'Create the anchored state from this thread segment.';
const KEEP_OPEN = 'The caller named what the anchored state MUST retain, verbatim where it can:\n\n<keep>\n';
const KEEP_CLOSE = '\n</keep>';
const SEGMENT_OPEN = '<thread-segment>';
const SEGMENT_CLOSE = '</thread-segment>';
const JOIN = '\n\n';

function threadCompactionPrompt(texts: readonly string[], priorSummary: string | null, template: string, keep?: string): string {
  return [
    priorSummary ? `${PRIOR_OPEN}${priorSummary}${PRIOR_CLOSE}` : FRESH,
    template,
    ...(keep === undefined ? [] : [`${KEEP_OPEN}${keep}${KEEP_CLOSE}`]),
    SEGMENT_OPEN,
    texts.filter((text) => text !== '').join(JOIN),
    SEGMENT_CLOSE,
  ].join(JOIN);
}

function frameLength(priorChars: number, template: string, keep: string | undefined): number {
  const parts = keep === undefined ? 5 : 6;
  return (
    (priorChars > 0 ? PRIOR_OPEN.length + priorChars + PRIOR_CLOSE.length : FRESH.length) +
    template.length +
    (keep === undefined ? 0 : KEEP_OPEN.length + keep.length + KEEP_CLOSE.length) +
    SEGMENT_OPEN.length +
    SEGMENT_CLOSE.length +
    JOIN.length * (parts - 1)
  );
}

type SizedSegment = { readonly texts: readonly string[]; readonly prefix: readonly number[] };

const SIZED = new WeakMap<readonly Message[], SizedSegment>();

function serialized(messages: readonly Message[]): SizedSegment {
  const held = SIZED.get(messages);
  if (held !== undefined) return held;
  const texts = messages.map(serializeThreadMessage);
  const prefix = [0];
  for (let index = 0; index < texts.length; index += 1) {
    const chars = texts[index]!.length;
    prefix.push(prefix[index]! + (chars === 0 ? 0 : chars + JOIN.length));
  }
  const sized = { texts, prefix };
  SIZED.set(messages, sized);
  return sized;
}

function sizedSegment(messages: readonly Message[]): readonly number[] {
  return serialized(messages).prefix;
}

function bodyLength(prefix: readonly number[], from: number, before: number): number {
  const to = Math.min(before, prefix.length - 1);
  return to <= from ? 0 : Math.max(0, prefix[to]! - prefix[from]! - JOIN.length);
}

function charTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

function fixedTokens(request: ModelRequest): number {
  return estimateThreadTokens({
    system: request.system || undefined,
    providerOptions: request.providerOptions,
  });
}

function fittingCut(
  messages: readonly Message[],
  prefix: readonly number[],
  from: number,
  before: number,
  frame: number,
  promptTokens: number,
): number | null {
  let cut: number | null = before;
  while (cut !== null && cut > from) {
    if (charTokens(frame + bodyLength(prefix, from, cut)) <= promptTokens) return cut;
    cut = previousThreadCompactionBoundary(messages, from, cut);
  }
  return null;
}

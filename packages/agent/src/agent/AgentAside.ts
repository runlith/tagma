import { Data, Effect, Stream } from 'effect';
import { LLMResponse, type Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity, type CachePolicy } from '@runlith/llm/schema/options';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { LLMError } from '@runlith/llm/schema/errors';
import { latestReaderMark } from './AgentSignal';
import type { ModelRequest, ModelToolChoice } from './modelPort';
import type { ToolCatalog } from './ToolCatalog';
import * as ResponseFold from '@runlith/llm/schema/responseFold';

export class AgentAsideCalledTool extends Data.TaggedError('AgentAsideCalledTool')<{
  readonly tools: readonly string[];
  readonly text: string;
  readonly finishReason: FinishReason | null;
  readonly usage: Usage | undefined;
}> {
  override get message(): string {
    return `The aside was answered with a tool call (${this.tools.join(', ')}) rather than with text.`;
  }
}

export type AgentAsideBinding = {
  readonly origin: ModelIdentity | undefined;
  readonly account: string | undefined;
  readonly cache: CachePolicy | undefined;
};

export namespace AgentAsideBinding {
  export const same = (left: AgentAsideBinding, right: AgentAsideBinding): boolean =>
    left.account === right.account &&
    (left.origin === undefined && right.origin === undefined ? true : ModelIdentity.same(left.origin, right.origin));

  export const cacheMs = (policy: CachePolicy | undefined): number | undefined =>
    typeof policy === 'object' && policy.ttlSeconds !== undefined ? policy.ttlSeconds * 1000 : undefined;
}

export type AgentAsideInput = {
  readonly runId: string;
  readonly stepNumber: number;
  readonly request: ModelRequest;
  readonly messages: readonly Message[];
  readonly tools: ToolCatalog;
  readonly activeTools?: readonly string[] | undefined;
  readonly toolChoice?: ModelToolChoice | undefined;
  readonly stallMs: number;
  readonly sentAt?: number | undefined;
  readonly ttlMs?: number | undefined;
  readonly answer?: AgentAsideAnswered | undefined;
};

export type AgentAsideAnswered = {
  readonly messages: readonly Message[];
  readonly measuredAt: number;
};

export type AgentAsideQuestion = {
  readonly instruction: string;
};

export type AgentAsideAnswer = {
  readonly text: string;
  readonly finishReason: FinishReason | null;
  readonly usage: Usage | undefined;
};

export type AgentAsideSource = 'capture' | 'session';

export type AgentAside = {
  readonly source: AgentAsideSource;
  readonly runId: string;
  readonly stepNumber: number;
  readonly readerInput: string | null;
  readonly readerPosition: number | null;
  readonly binding: AgentAsideBinding;
  readonly reasoning: string | null;
  readonly sentAt: number | null;
  readonly measuredAt: number | null;
  readonly expiresAt: number | null;
  ask(question: AgentAsideQuestion): Effect.Effect<AgentAsideAnswer, LLMError | AgentAsideCalledTool>;
};

export type AgentAsideHook = (aside: AgentAside) => Effect.Effect<void>;

export type AgentAsideCapture = (aside: AgentAside) => Effect.Effect<void>;

export function agentAside(input: AgentAsideInput): AgentAside {
  const sentAt = input.sentAt ?? null;
  const ttlMs = input.ttlMs ?? AgentAsideBinding.cacheMs(input.request.cache);
  const answer = input.answer;
  const reader = latestReaderMark(input.messages);
  return {
    source: 'capture',
    runId: input.runId,
    stepNumber: input.stepNumber,
    readerInput: reader?.input ?? null,
    readerPosition: reader?.position ?? null,
    binding: {
      origin: input.request.origin,
      account: input.request.signedAccount?.(),
      cache: input.request.cache,
    },
    reasoning: input.request.rung ?? null,
    sentAt,
    measuredAt: answer?.measuredAt ?? null,
    expiresAt: sentAt === null || ttlMs === undefined ? null : sentAt + ttlMs,
    ask: (question) =>
      Effect.flatMap(
        input.request
          .stream({
            messages: [...input.messages, ...(answer?.messages ?? []), Message.user(question.instruction)],
            tools: input.tools,
            activeTools: input.activeTools,
            toolChoice: input.toolChoice,
            stallMs: input.stallMs,
          })
          .pipe(Stream.runFold(() => ResponseFold.empty(input.request.origin), ResponseFold.reduce)),
        (folded) => {
          const response = ResponseFold.complete(folded);
          const reached = (response?.message.content ?? []).filter((part) => part.type === 'tool-call').map((part) => part.name);
          const usage = response ? LLMResponse.usage(response) : undefined;
          if (reached.length > 0)
            return Effect.fail(
              new AgentAsideCalledTool({
                tools: reached,
                text: response?.text ?? '',
                finishReason: response?.finishReason ?? null,
                usage,
              }),
            );
          return Effect.succeed({
            text: response?.text ?? '',
            finishReason: response?.finishReason ?? null,
            usage,
          } satisfies AgentAsideAnswer);
        },
      ),
  };
}

import { Effect, Schema } from 'effect';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import * as Auth from '@runlith/llm/route/auth';
import * as Gemini from '@runlith/llm/protocols/gemini';
import * as OpenAICompatibleChat from '@runlith/llm/protocols/openai-compatible-chat';
import * as OpenAIResponses from '@runlith/llm/protocols/openai-responses';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import type { Model, ProviderOptions } from '@runlith/llm/schema/options';
import { QuotaInvalidResponse, QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { OPENCODE_GO_PROVIDER, opencodeGoDescription } from '../models/opencodeGo';
import { cacheGroupSession } from '@runlith/llm/profiles/clientSession';
import { consoleKey } from '@runlith/llm/profiles/credential';
import type {
  ModelProfile,
  ProductIdentity,
  ProfileCall,
  ProfileSelection,
  ProviderQuota,
  ProviderRegistration,
  VendorRegistrations,
} from '@runlith/llm/profiles/contract';
import { quotaGet } from '@runlith/llm/profiles/quotaRead';
import { reasoningRung, thinkingBudget } from '@runlith/llm/profiles/reasoning';

export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go/v1';

export const opencodeGoUserAgent = (product: ProductIdentity): string => `${product.client.name}/${product.client.version}`;

export const OPENCODE_GO_OUTPUT_RESERVATION = 32_000;

const ROLLING_WINDOW_MINUTES = 300;

type GoWire = 'chat' | 'responses' | 'messages' | 'gemini';

const WIRE_OF_MODEL: Readonly<Record<string, GoWire>> = {
  'glm-5.3-flash': 'chat',
  'glm-5.3': 'chat',
  'glm-5.2': 'chat',
  'glm-5.1': 'chat',
  'kimi-k3': 'chat',
  'kimi-k2.7-code': 'chat',
  'kimi-k2.6': 'chat',
  'longcat-2.0': 'chat',
  'deepseek-v4.1-flash': 'chat',
  'deepseek-v4-pro': 'chat',
  'mimo-v2.5': 'chat',
  'mimo-v2.5-pro': 'chat',
  hy3: 'chat',
  'hy4-preview': 'chat',
  'gemini-4-argon-contributor': 'gemini',
  'gpt-5.6-luna': 'responses',
  'grok-4.6': 'responses',
  'muse-spark-1.3-contributor': 'responses',
  'muse-spark-1.2-contributor': 'responses',
  'minimax-m3': 'messages',
  'minimax-m2.7': 'messages',
  'qwen3.8-max': 'messages',
  'qwen3.8-flash': 'messages',
  'qwen3.7-plus': 'messages',
  'qwen3.7-max': 'messages',
  'qwen3.6-plus': 'messages',
  'union-alpha': 'messages',
};

const GEMINI_LEVELS: ReadonlySet<string> = new Set<Gemini.GeminiThinkingLevel>(['minimal', 'low', 'medium', 'high']);
const isGeminiLevel = (rung: string | undefined): rung is Gemini.GeminiThinkingLevel => rung !== undefined && GEMINI_LEVELS.has(rung);

const REASONING_ECHO_REQUIRED: ReadonlySet<string> = new Set(['deepseek-v4.1-flash', 'deepseek-v4-pro']);

const unknownModel = (model: string) =>
  new LLMError({
    module: 'OpenCodeGo',
    method: 'model',
    reason: new InvalidRequestReason({
      message: `"${model}" is not an OpenCode Go model this build serves: no wire is declared for it.`,
    }),
  });

const GoUsageWindow = Schema.Struct({
  status: Schema.String,
  percent: Schema.Number,
  resetsAt: Schema.String,
});

const GoUsagePayload = Schema.Struct({
  usage: Schema.Struct({
    rolling: GoUsageWindow,
    weekly: GoUsageWindow,
    monthly: GoUsageWindow,
  }),
});

const goWindow = (reported: typeof GoUsageWindow.Type, kind: 'bucket' | 'weekly' | 'monthly', windowMinutes?: number): QuotaWindow => {
  const resetMillis = Date.parse(reported.resetsAt);
  return new QuotaWindow({
    kind,
    usedPercent: Math.min(100, Math.max(0, reported.percent)),
    windowMinutes,
    resetsAt: Number.isNaN(resetMillis) ? undefined : resetMillis / 1_000,
  });
};

export const opencodeGoUsage = (body: unknown, observedAt: Date) =>
  Schema.decodeUnknownEffect(GoUsagePayload)(body).pipe(
    Effect.mapError(
      (issue) => new QuotaInvalidResponse({ message: `The OpenCode Go usage answer did not match its schema: ${issue.message}` }),
    ),
    Effect.map(
      (payload) =>
        new QuotaObservation({
          observedAt,
          source: 'usage',
          windows: [
            goWindow(payload.usage.rolling, 'bucket', ROLLING_WINDOW_MINUTES),
            goWindow(payload.usage.weekly, 'weekly'),
            goWindow(payload.usage.monthly, 'monthly'),
          ],
        }),
    ),
  );

const quotaFromHeaders: ProviderQuota['fromHeaders'] = () => null;

export const opencodeGoQuota = (product: ProductIdentity): ProviderQuota => ({
  fromHeaders: quotaFromHeaders,
  read: (credentials, ownerId, account) =>
    quotaGet({
      url: `${OPENCODE_GO_BASE_URL}/usage`,
      auth: consoleKey(credentials, ownerId, OPENCODE_GO_PROVIDER, account).bearer(),
      headers: { Accept: 'application/json', 'User-Agent': opencodeGoUserAgent(product) },
    }).pipe(Effect.flatMap((reply) => opencodeGoUsage(reply.body, reply.observedAt))),
});

const goOptions = (call: ProfileCall): ProviderOptions | undefined => {
  const rung = reasoningRung(call.rung);
  switch (WIRE_OF_MODEL[call.model]) {
    case 'responses':
      return OpenAIResponses.options({
        store: false,
        reasoningEffort: rung,
        parallelToolCalls: call.parallelToolCalls,
      });
    case 'gemini':
      return Gemini.options({
        thinkingConfig: { thinkingLevel: isGeminiLevel(rung) ? rung : undefined, includeThoughts: true },
      });
    case 'messages': {
      const budget = thinkingBudget(rung, call.outputTokens);
      return AnthropicMessages.options({
        thinking: budget === undefined ? undefined : { type: 'enabled', budgetTokens: budget },
        disableParallelToolUse: call.parallelToolCalls === undefined ? undefined : !call.parallelToolCalls,
      });
    }
    case undefined:
      return undefined;
    default:
      return OpenAICompatibleChat.options({
        reasoningEffort: rung,
        parallelToolCalls: call.parallelToolCalls,
      });
  }
};

const goModel = (selection: ProfileSelection, product: ProductIdentity, wire: GoWire, session: string): Model => {
  const key = consoleKey(selection.credentials, selection.ownerId, OPENCODE_GO_PROVIDER, selection.account);
  const shared = {
    provider: OPENCODE_GO_PROVIDER,
    quota: quotaFromHeaders,
    endpoint: { baseURL: OPENCODE_GO_BASE_URL },
    limits: { output: OPENCODE_GO_OUTPUT_RESERVATION },
    headers: { 'User-Agent': opencodeGoUserAgent(product), 'x-opencode-session': session },
  } as const;
  if (wire === 'messages') {
    return AnthropicMessages.route.with({ ...shared, auth: key.pipe(Auth.header('x-api-key')) }).model({ id: selection.model });
  }
  if (wire === 'gemini') {
    return Gemini.route.with({ ...shared, auth: key.pipe(Auth.header('x-goog-api-key')) }).model({ id: selection.model });
  }
  const route = wire === 'responses' ? OpenAIResponses.route : OpenAICompatibleChat.route;
  return route.with({ ...shared, auth: key.bearer() }).model({
    id: selection.model,
    compatibility: REASONING_ECHO_REQUIRED.has(selection.model) ? { reasoningEcho: 'required' } : undefined,
  });
};

const opencodeGoProfile = (product: ProductIdentity): ModelProfile => ({
  output: { budget: OPENCODE_GO_OUTPUT_RESERVATION, sent: true },
  model: Effect.fn('opencodeGo.model')(function* (selection) {
    const wire = WIRE_OF_MODEL[selection.model];
    if (wire === undefined) return yield* unknownModel(selection.model);
    const session = yield* Effect.promise(() => cacheGroupSession(selection.cacheGroup));
    return goModel(selection, product, wire, session);
  }),
  options: goOptions,
});

export const opencodeGoRegistration = (product: ProductIdentity): ProviderRegistration => ({
  ...opencodeGoDescription,
  profile: opencodeGoProfile(product),
  quota: opencodeGoQuota(product),
});

export const opencodeGoRegistrations: VendorRegistrations = (product) => [opencodeGoRegistration(product)];

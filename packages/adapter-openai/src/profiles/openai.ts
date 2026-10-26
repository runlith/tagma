import { Effect, Schema } from 'effect';
import { Headers } from 'effect/http';
import * as Auth from '@runlith/llm/route/auth';
import * as OpenAIResponses from '@runlith/llm/protocols/openai-responses';
import type { Model, ProviderOptions } from '@runlith/llm/schema/options';
import { QuotaInvalidResponse, QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import {
  OPENAI_OAUTH_PROVIDER,
  OPENAI_PROVIDER,
  OpenAISubscriptionCredential,
  openaiConsoleDescription,
  openaiSubscriptionDescription,
} from '../models/openai';
import { cacheGroupSession } from '@runlith/llm/profiles/clientSession';
import { openaiTurnHeaders, openaiUserAgent } from './openaiClient';
import { codexWeb } from './codexWeb';
import { CODEX_WEB } from './codexWeb.generated';
import { codexImages } from './codexImages';
import { CODEX_IMAGES } from './codexImages.generated';
import type { ImageProfile } from '@runlith/llm/profiles/images';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import { consoleKey, subscriptionFact, subscriptionToken } from '@runlith/llm/profiles/credential';
import type {
  ModelProfile,
  ProductIdentity,
  ProfileCall,
  ProfileSelection,
  ProviderQuota,
  ProviderRegistration,
  VendorRegistrations,
} from '@runlith/llm/profiles/contract';
import { quotaGet, unsupportedQuota } from '@runlith/llm/profiles/quotaRead';
import type { ModelRetryPolicy } from '@runlith/llm/route/ModelRetryPolicy';
import { reasoningRung } from '@runlith/llm/profiles/reasoning';

export const OPENAI_CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export const OPENAI_OUTPUT_RESERVATION = 32_000;

const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

const OpenAIUsageWindow = Schema.Struct({
  used_percent: Schema.Number,
  limit_window_seconds: Schema.optional(Schema.Number),
  reset_at: Schema.optional(Schema.Number),
});
const OpenAIUsageLimits = Schema.Struct({
  primary_window: Schema.optional(Schema.NullOr(OpenAIUsageWindow)),
  secondary_window: Schema.optional(Schema.NullOr(OpenAIUsageWindow)),
});
const OpenAIUsagePayload = Schema.Struct({
  plan_type: Schema.String,
  rate_limit: OpenAIUsageLimits,
  additional_rate_limits: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          limit_name: Schema.String,
          rate_limit: Schema.optional(Schema.NullOr(OpenAIUsageLimits)),
        }),
      ),
    ),
  ),
  rate_limit_reset_credits: Schema.optional(Schema.NullOr(Schema.Struct({ available_count: Schema.Number }))),
});

const headerText = (headers: Headers.Headers, name: string): string | undefined => {
  const value = headers[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

const headerNumber = (headers: Headers.Headers, name: string): number | null => {
  const value = headerText(headers, name);
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isSparkLimit = (name: string): boolean =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .includes('codexspark');

type CodexSlot = 'primary' | 'secondary' | 'bucket';

const WEEK_MINUTES = 7 * 24 * 60;
const MONTH_MINUTES = 28 * 24 * 60;

const slotKind = (slot: CodexSlot, windowMinutes: number | undefined): QuotaWindow['kind'] => {
  if (slot === 'bucket') return 'bucket';
  if (windowMinutes === undefined) return slot === 'primary' ? 'session' : 'weekly';
  if (windowMinutes >= MONTH_MINUTES) return 'monthly';
  return windowMinutes >= WEEK_MINUTES ? 'weekly' : 'session';
};

const codexWindow = (
  slot: CodexSlot,
  figures: { usedPercent: number; windowMinutes?: number | undefined; resetsAt?: number | undefined },
  label?: string,
): QuotaWindow | null =>
  figures.windowMinutes === 0
    ? null
    : new QuotaWindow({
        kind: slotKind(slot, figures.windowMinutes),
        label,
        usedPercent: figures.usedPercent,
        windowMinutes: figures.windowMinutes,
        resetsAt: figures.resetsAt,
      });

const quotaWindow = (headers: Headers.Headers, prefix: string, slot: CodexSlot, label?: string): QuotaWindow | null => {
  const usedPercent = headerNumber(headers, `${prefix}-used-percent`);
  if (usedPercent === null) return null;
  return codexWindow(
    slot,
    {
      usedPercent,
      windowMinutes: headerNumber(headers, `${prefix}-window-minutes`) ?? undefined,
      resetsAt: headerNumber(headers, `${prefix}-reset-at`) ?? undefined,
    },
    label,
  );
};

const codexQuota = (headers: Headers.Headers, observedAt: Date): QuotaObservation | null => {
  const windows: QuotaWindow[] = [];
  const primary = quotaWindow(headers, 'x-codex-primary', 'primary');
  const secondary = quotaWindow(headers, 'x-codex-secondary', 'secondary');
  if (primary !== null) windows.push(primary);
  if (secondary !== null) windows.push(secondary);

  for (const name of Object.keys(headers)) {
    const match = /^x-(.+)-primary-used-percent$/.exec(name);
    if (match === null || match[1] === 'codex') continue;
    const limit = match[1]!;
    const normalized = limit.trim().toLowerCase().replaceAll('-', '_');
    const prefix = `x-${limit}-primary`;
    const label = headerText(headers, `x-${limit}-limit-name`) ?? normalized;
    if (isSparkLimit(label)) continue;
    const bucket = quotaWindow(headers, prefix, 'bucket', label);
    if (bucket !== null) windows.push(bucket);
  }

  if (windows.length === 0) return null;
  return new QuotaObservation({
    observedAt,
    source: 'reply',
    windows,
  });
};

const usageWindow = (value: typeof OpenAIUsageWindow.Type, slot: CodexSlot, label?: string): QuotaWindow | null =>
  codexWindow(
    slot,
    {
      usedPercent: Math.min(100, Math.max(0, value.used_percent)),
      windowMinutes: value.limit_window_seconds === undefined ? undefined : value.limit_window_seconds / 60,
      resetsAt: value.reset_at,
    },
    label,
  );

const openAIUsage = (body: unknown, observedAt: Date) =>
  Schema.decodeUnknownEffect(OpenAIUsagePayload)(body).pipe(
    Effect.mapError((issue) => new QuotaInvalidResponse({ message: `The OpenAI usage answer did not match its schema: ${issue.message}` })),
    Effect.flatMap((payload) => {
      const windows: QuotaWindow[] = [];
      const read = (value: typeof OpenAIUsageWindow.Type | null | undefined, slot: CodexSlot, label?: string) => {
        const window = value === undefined || value === null ? null : usageWindow(value, slot, label);
        if (window !== null) windows.push(window);
      };
      read(payload.rate_limit.primary_window, 'primary');
      read(payload.rate_limit.secondary_window, 'secondary');
      for (const additional of payload.additional_rate_limits ?? []) {
        if (isSparkLimit(additional.limit_name)) continue;
        read(additional.rate_limit?.primary_window, 'bucket', additional.limit_name);
      }
      return windows.length === 0
        ? Effect.fail(new QuotaInvalidResponse({ message: 'The OpenAI usage answer carried no quota windows.' }))
        : Effect.succeed(
            new QuotaObservation({
              observedAt,
              source: 'usage',
              windows,
              plan: payload.plan_type,
              resetCredits: payload.rate_limit_reset_credits?.available_count,
            }),
          );
    }),
  );

export const openaiQuota = (product: ProductIdentity): ProviderQuota => ({
  fromHeaders: codexQuota,
  read: (credentials, ownerId, account) =>
    quotaGet({
      url: OPENAI_USAGE_URL,
      auth: chatgptUsageIdentity({ credentials, ownerId, account }, product),
      headers: { Accept: 'application/json' },
    }).pipe(Effect.flatMap((reply) => openAIUsage(reply.body, reply.observedAt))),
});

const openaiConsoleQuota: ProviderQuota = {
  fromHeaders: codexQuota,
  read: unsupportedQuota,
};

function openaiOptions(call: ProfileCall): ProviderOptions {
  const effort = reasoningRung(call.rung);
  return OpenAIResponses.options({
    store: false,
    reasoningEffort: effort,
    reasoningSummary: effort !== undefined && call.reasoningOutput ? 'auto' : undefined,
    promptCacheKey: call.cacheGroup,
    parallelToolCalls: call.parallelToolCalls,
    serviceTier: call.switches['serviceTier'] === 'priority' ? 'priority' : undefined,
  });
}

const openaiConsoleProfile: ModelProfile = {
  output: { budget: OPENAI_OUTPUT_RESERVATION, sent: true },
  model: (selection) => Effect.succeed(consoleModel(selection)),
  options: openaiOptions,
};

const credentialRecovery = ({ credentials, ownerId, account }: ProfileSelection): ModelRetryPolicy => {
  const recover = credentials.recoverAccessToken;
  return {
    recover:
      recover === undefined
        ? undefined
        : subscriptionFact('OpenAI credential recovery', () => recover.call(credentials, ownerId, OPENAI_OAUTH_PROVIDER, account)).pipe(
            Effect.asVoid,
          ),
  };
};

const openCodexWeb = codexWeb(CODEX_WEB);

const subscriptionWeb = (selected: ProfileSelection, product: ProductIdentity) => {
  if (!CODEX_WEB.models.includes(selected.model)) return undefined;
  return Effect.sync(() => {
    const selection = { ...selected, cacheGroup: selected.cacheGroup || undefined };
    return openCodexWeb({
      url: `${OPENAI_CHATGPT_BASE_URL}${CODEX_WEB.path}`,
      auth: chatgptIdentity(selection, product),
      recover: credentialRecovery(selection).recover,
      session: Effect.promise(() => cacheGroupSession(selection.cacheGroup)),
      model: selection.model,
    });
  });
};

const IMAGES_LIMIT = 'images';

const imageQuota = (headers: Headers.Headers, observedAt: Date): QuotaObservation | null => {
  if (headerText(headers, 'x-codex-active-limit') === undefined) return null;
  const window = quotaWindow(headers, 'x-codex-primary', 'bucket', IMAGES_LIMIT);
  return window === null ? null : new QuotaObservation({ observedAt, source: 'reply', windows: [window] });
};

const drawCodexImages = codexImages(CODEX_IMAGES);

const subscriptionImages = (product: ProductIdentity): ImageProfile => ({
  generate: (selection, request) => {
    const spec = openaiSubscriptionDescription.imageModels?.[request.model];
    if (spec === undefined) return Effect.fail(unknownImageModel(request.model));
    return drawCodexImages(
      spec,
      { baseURL: OPENAI_CHATGPT_BASE_URL, auth: chatgptIdentity(selection, product), recover: credentialRecovery(selection).recover },
      request,
    );
  },
  quota: imageQuota,
});

const unknownImageModel = (model: string): LLMError =>
  new LLMError({
    module: 'Images',
    method: 'generate',
    reason: new InvalidRequestReason({ message: `${model} is not an image model ChatGPT serves.` }),
  });

const openaiSubscriptionProfile = (product: ProductIdentity): ModelProfile => ({
  web: (selection) => subscriptionWeb(selection, product),
  retry: credentialRecovery,
  output: { budget: OPENAI_OUTPUT_RESERVATION, sent: false },
  model: (selection) => Effect.succeed(subscriptionModel(selection, product)),
  options: openaiOptions,
});

function consoleModel(selection: ProfileSelection): Model {
  return OpenAIResponses.route
    .with({
      provider: OPENAI_PROVIDER,
      quota: openaiConsoleQuota.fromHeaders,
      limits: { output: OPENAI_OUTPUT_RESERVATION },
      auth: consoleKey(selection.credentials, selection.ownerId, OPENAI_PROVIDER, selection.account).bearer(),
    })
    .model({ id: selection.model });
}

type ChatGPTIdentitySelection = Pick<ProfileSelection, 'credentials' | 'ownerId' | 'account' | 'cacheGroup'>;

const decodeSubscription = Schema.decodeUnknownPromise(OpenAISubscriptionCredential);

async function chatgptAccountId(selection: Pick<ProfileSelection, 'credentials' | 'ownerId' | 'account'>): Promise<string | undefined> {
  return (await decodeSubscription(await selection.credentials.credential(selection.ownerId, OPENAI_OAUTH_PROVIDER, selection.account)))
    .accountId;
}

export function chatgptIdentity(selection: ChatGPTIdentitySelection, product: ProductIdentity): Auth.Auth {
  return subscriptionToken(selection.credentials, selection.ownerId, OPENAI_OAUTH_PROVIDER, selection.account)
    .bearer()
    .andThen(
      Auth.custom((input) =>
        Effect.all({
          accountId: subscriptionFact('ChatGPT account id', () => chatgptAccountId(selection)),
          sessionId: Effect.promise(() => cacheGroupSession(selection.cacheGroup)),
        }).pipe(
          Effect.map(({ accountId, sessionId }) =>
            Headers.setAll(input.headers, {
              ...openaiTurnHeaders(product, sessionId),
              ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
            }),
          ),
        ),
      ),
    );
}

function chatgptUsageIdentity(
  selection: Pick<ProfileSelection, 'credentials' | 'ownerId' | 'account'>,
  product: ProductIdentity,
): Auth.Auth {
  return subscriptionToken(selection.credentials, selection.ownerId, OPENAI_OAUTH_PROVIDER, selection.account)
    .bearer()
    .andThen(
      Auth.custom((input) =>
        subscriptionFact('ChatGPT account id', () => chatgptAccountId(selection)).pipe(
          Effect.map((accountId) =>
            Headers.setAll(input.headers, {
              'User-Agent': openaiUserAgent(product),
              ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
            }),
          ),
        ),
      ),
    );
}

function codexRouting(model: string): Auth.Auth {
  return Auth.custom((input) => {
    const tier = input.request ? OpenAIResponses.serviceTier(input.request) : undefined;
    const hint = `model=${model}${tier ? `;tier=${tier}` : ''}`;
    return Effect.succeed(Headers.setAll(input.headers, { 'x-codex-routing-hint': hint }));
  });
}

function subscriptionModel(selection: ProfileSelection, product: ProductIdentity): Model {
  return OpenAIResponses.route
    .with({
      provider: OPENAI_OAUTH_PROVIDER,
      quota: codexQuota,
      endpoint: { baseURL: OPENAI_CHATGPT_BASE_URL },
      auth: chatgptIdentity(selection, product).andThen(codexRouting(selection.model)),
      retry: credentialRecovery(selection),
    })
    .model({ id: selection.model });
}

export const openaiConsoleRegistration: ProviderRegistration = {
  ...openaiConsoleDescription,
  profile: openaiConsoleProfile,
  quota: openaiConsoleQuota,
};

export const openaiSubscriptionRegistration = (product: ProductIdentity): ProviderRegistration => ({
  ...openaiSubscriptionDescription,
  profile: openaiSubscriptionProfile(product),
  quota: openaiQuota(product),
  images: subscriptionImages(product),
});

export const openaiRegistrations: VendorRegistrations = (product) => [openaiSubscriptionRegistration(product), openaiConsoleRegistration];

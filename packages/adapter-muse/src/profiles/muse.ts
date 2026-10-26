import { Effect } from 'effect';
import * as OpenAIResponses from '@runlith/llm/protocols/openai-responses';
import { MUSE_API_BASE_URL, MUSE_PROVIDER, museConsoleDescription } from '../models/muse';
import { consoleKey } from '@runlith/llm/profiles/credential';
import { museToolSchema } from './museToolSchema';
import type {
  ModelProfile,
  ProductIdentity,
  ProfileCall,
  ProfileSelection,
  ProviderQuota,
  ProviderRegistration,
} from '@runlith/llm/profiles/contract';
import { unsupportedQuota } from '@runlith/llm/profiles/quotaRead';
import { reasoningRung } from '@runlith/llm/profiles/reasoning';

export const MUSE_OUTPUT_RESERVATION = 32_000;

export const museUserAgent = (product: ProductIdentity): string => `muse-build/${product.client.name}`;

export function museOptions(call: ProfileCall) {
  const effort = call.rung === 'none' ? undefined : reasoningRung(call.rung);
  return OpenAIResponses.options({
    store: false,
    reasoningEffort: effort,
    reasoningSummary: effort !== undefined && call.reasoningOutput ? 'auto' : undefined,
    promptCacheKey: call.cacheGroup,
    parallelToolCalls: call.parallelToolCalls,
  });
}

const museConsoleQuota: ProviderQuota = {
  fromHeaders: () => null,
  read: unsupportedQuota,
};

const museConsoleProfile = (product: ProductIdentity): ModelProfile => ({
  output: { budget: MUSE_OUTPUT_RESERVATION, sent: true },
  model: (selection: ProfileSelection) =>
    Effect.succeed(
      OpenAIResponses.route
        .with({
          provider: MUSE_PROVIDER,
          quota: museConsoleQuota.fromHeaders,
          endpoint: { baseURL: MUSE_API_BASE_URL },
          limits: { output: MUSE_OUTPUT_RESERVATION },
          auth: consoleKey(selection.credentials, selection.ownerId, MUSE_PROVIDER, selection.account).bearer(),
          headers: { 'user-agent': museUserAgent(product) },
        })
        .model({ id: selection.model, compatibility: { toolSchema: museToolSchema } }),
    ),
  options: museOptions,
});

export const museConsoleRegistration = (product: ProductIdentity): ProviderRegistration => ({
  ...museConsoleDescription,
  profile: museConsoleProfile(product),
  quota: museConsoleQuota,
});

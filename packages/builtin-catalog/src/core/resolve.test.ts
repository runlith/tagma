import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { resolveModelCall } from '@runlith/llm/models/resolve';
import { opencodeGoRegistration } from '@runlith/adapter-opencode-go/profiles/opencodeGo';
import type { ModelCredentials, ProviderRegistration } from '@runlith/llm/profiles/contract';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';

const credentials: ModelCredentials = {
  apiKey: async () => 'sk-test',
  accessToken: async () => 'oauth-token',
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account-uuid', email: 'operator@example.com' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: 'account-1',
  }),
};

const resolve = (registration: ProviderRegistration, model: string) =>
  Effect.fromResult(resolveModelCall(modelCatalog([registration]), { ownerId: 'owner', provider: registration.id, model, credentials }));

describe('the output ceiling a request sends against the one planning spends', () => {
  it.effect("an ordinary registration sends the row's own ceiling and plans the shared reservation", () =>
    Effect.gen(function* () {
      const resolved = yield* resolve(opencodeGoRegistration(RECORDED_PRODUCT), 'deepseek-v4.1-flash');
      expect(resolved.maxOutputTokens).toBe(384_000);
      expect(resolved.plannedOutputTokens).toBe(32_000);
    }),
  );

  it.effect('a registration standing in for a foreign client sends its reservation verbatim', () =>
    Effect.gen(function* () {
      const registration = opencodeGoRegistration(RECORDED_PRODUCT);
      const foreign = {
        ...registration,
        profile: { ...registration.profile, output: { budget: 128_000, sent: true, verbatim: true } },
      } as const;
      const resolved = yield* resolve(foreign, 'deepseek-v4.1-flash');
      expect(resolved.maxOutputTokens).toBe(128_000);
      expect(resolved.plannedOutputTokens).toBe(128_000);
    }),
  );

  it.effect("a caller's own ask still lowers what is sent", () =>
    Effect.gen(function* () {
      const registration = opencodeGoRegistration(RECORDED_PRODUCT);
      const resolved = yield* Effect.fromResult(
        resolveModelCall(modelCatalog([registration]), {
          ownerId: 'owner',
          provider: registration.id,
          model: 'deepseek-v4.1-flash',
          credentials,
          maxOutputTokens: 4_000,
        }),
      );
      expect(resolved.maxOutputTokens).toBe(4_000);
    }),
  );
});

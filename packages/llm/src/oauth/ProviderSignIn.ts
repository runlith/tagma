import { Clock, Data, Effect, type Layer } from 'effect';
import type { HttpClient } from 'effect/http';
import type { AuthStatus, ProviderSignInBegin } from '../models/authStatus.js';
import type { AccountRow, StoredCredential } from './credential.js';
import { DEVICE_CODE_SLOW_DOWN_INCREMENT_MS, type DeviceAuthorization, deviceAuthorization, deviceGrantPoll } from './flows/deviceGrant';
import { OAuthFlowFailed } from './flows/vendorPayload';
import type { DeviceSignIn, FlowFailure, SubscriptionAccounts } from './vendor.js';

export class ProviderSignInPendingError extends Data.TaggedError('ProviderSignInPendingError')<{
  readonly reason: string;
  readonly slowDown: boolean;
}> {
  override get message(): string {
    return this.reason;
  }
}

type PendingDevice = DeviceAuthorization & { readonly startedAt: number; nextPollAt: number };

type SignInFailure = FlowFailure | ProviderSignInPendingError;

const PENDING_SIGN_IN_TTL_MS = 15 * 60_000;

export type ProviderSignIn = {
  readonly begin: (
    scope: string,
    provider: string,
    flow: DeviceSignIn<StoredCredential>,
  ) => Effect.Effect<ProviderSignInBegin, OAuthFlowFailed>;
  readonly complete: (
    scope: string,
    provider: string,
    flow: DeviceSignIn<StoredCredential>,
  ) => Effect.Effect<StoredCredential, SignInFailure>;
  readonly forget: (scope: string, provider: string) => void;
};

type SignInOptions = { readonly wire: Layer.Layer<HttpClient.HttpClient> };

export function makeProviderSignIn({ wire }: SignInOptions): ProviderSignIn {
  const pendings = new Map<string, PendingDevice>();
  const signIn: ProviderSignIn = {
    begin: Effect.fnUntraced(function* (scope, provider, flow) {
      const device = yield* deviceAuthorization(flow.vendor);
      const startedAt = yield* Clock.currentTimeMillis;
      pendings.set(key(scope, provider), { ...device, startedAt, nextPollAt: startedAt });
      return {
        flow: 'device',
        authorizeUrl: device.verificationUriComplete ?? device.verificationUri,
        userCode: device.userCode,
      } satisfies ProviderSignInBegin;
    }, Effect.provide(wire)),
    complete: Effect.fnUntraced(function* (scope, provider, flow) {
      const now = yield* Clock.currentTimeMillis;
      const pendingKey = key(scope, provider);
      const pending = pendings.get(pendingKey);
      if (!pending || now - pending.startedAt > PENDING_SIGN_IN_TTL_MS) {
        pendings.delete(pendingKey);
        return yield* new OAuthFlowFailed({ reason: 'No pending sign-in for this provider — start the sign-in again.' });
      }
      if (now >= pending.expiresAt) {
        pendings.delete(pendingKey);
        return yield* new OAuthFlowFailed({ reason: 'Device code expired — start the sign-in again' });
      }
      const waiting = new ProviderSignInPendingError({ reason: 'Waiting for authorization in the browser.', slowDown: false });
      if (now < pending.nextPollAt) return yield* waiting;
      const result = yield* deviceGrantPoll(flow.vendor, pending);
      if (result.status === 'pending') {
        if (result.slowDown) pending.intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
        pending.nextPollAt = (yield* Clock.currentTimeMillis) + pending.intervalMs;
        return yield* new ProviderSignInPendingError({ reason: 'Waiting for authorization in the browser.', slowDown: result.slowDown });
      }
      pendings.delete(pendingKey);
      return yield* flow.store(result.tokens);
    }, Effect.provide(wire)),
    forget: (scope, provider) => {
      pendings.delete(key(scope, provider));
    },
  };
  return signIn;
}

export function providerAuthStatus(provider: string, row: AccountRow, accounts: SubscriptionAccounts): AuthStatus {
  return {
    account: row.key,
    provider,
    label: row.label,
    organization: accounts.organization?.(row.credential),
    expiresAt: row.credential.expiresAt,
    origin: row.origin,
    addedAt: row.addedAt,
  };
}

function key(scope: string, provider: string): string {
  return `${scope}:${provider}`;
}

import { Clock, Duration, Effect, Schema } from 'effect';
import { runFlow, vendorCallOrFail } from '../vendorCall';
import {
  OAuthFlowFailed,
  oauthFailure,
  parseVendorPayload,
  readableVendorAnswer,
  readOAuthError,
  vendorSeconds,
  withOAuthVendorCallTimeout,
} from './vendorPayload';

export type DeviceGrantVendor = {
  readonly label: string;
  readonly clientId: string;
  readonly deviceAuthorizationUrl: string;
  readonly tokenUrl: string;
  readonly headers: () => Record<string, string>;
  readonly scope?: string;
  readonly refreshOptional?: boolean;
};

export type DeviceGrantTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  idToken?: string;
};

export type ScopedGrant = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
};

export function deviceGrantTokensToStored(tokens: DeviceGrantTokens, existing?: ScopedGrant): ScopedGrant {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope || existing?.scope || '',
  };
}

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
};

export type DeviceGrantPoll = { status: 'pending'; slowDown: boolean } | { status: 'ready'; tokens: DeviceGrantTokens };

export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000;
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000;
export const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000;

const deviceGrantTokenSchema = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
  expires_in: vendorSeconds,
  scope: Schema.optional(Schema.String),
});

type DeviceGrantTokenPayload = typeof deviceGrantTokenSchema.Type;

const deviceCodeSchema = Schema.Struct({
  device_code: Schema.optional(Schema.String),
  user_code: Schema.optional(Schema.String),
  verification_uri: Schema.optional(Schema.String),
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: vendorSeconds,
  interval: vendorSeconds,
});

const postForm = Effect.fn('DeviceGrant.postForm')(function* (vendor: DeviceGrantVendor, url: string, body: Record<string, string>) {
  return yield* withOAuthVendorCallTimeout(
    Effect.gen(function* () {
      const response = yield* vendorCallOrFail(url, vendor.headers(), new URLSearchParams(body).toString());
      return { response, text: response.text };
    }),
    `${vendor.label} token exchange`,
  );
});

export const deviceAuthorization = Effect.fn('DeviceGrant.begin')(function* (vendor: DeviceGrantVendor) {
  const sent = {
    client_id: vendor.clientId,
    ...(vendor.scope ? { scope: vendor.scope } : {}),
  };
  const { response, text } = yield* postForm(vendor, vendor.deviceAuthorizationUrl, sent);
  if (!response.ok) {
    return yield* new OAuthFlowFailed({
      reason: `${vendor.label} device code request failed (${response.status}): ${readableVendorAnswer(text.trim(), sent) || response.statusText}`,
    });
  }
  const json = yield* Effect.try({
    try: () => parseVendorPayload(deviceCodeSchema, text, `${vendor.label} device code response`, sent),
    catch: oauthFailure,
  });
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    return yield* new OAuthFlowFailed({
      reason: `${vendor.label} device code response is missing device_code / user_code / verification_uri`,
    });
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresAt: (yield* Clock.currentTimeMillis) + positiveSecondsToMs(json.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS),
    intervalMs: Math.max(positiveSecondsToMs(json.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS), DEVICE_CODE_MIN_INTERVAL_MS),
  } satisfies DeviceAuthorization;
});

export function beginDeviceGrant(vendor: DeviceGrantVendor): Promise<DeviceAuthorization> {
  return runFlow(deviceAuthorization(vendor));
}

export const deviceGrantPoll = Effect.fn('DeviceGrant.poll')(function* (
  vendor: DeviceGrantVendor,
  device: Pick<DeviceAuthorization, 'deviceCode'>,
) {
  const sent = {
    grant_type: DEVICE_CODE_GRANT_TYPE,
    client_id: vendor.clientId,
    device_code: device.deviceCode,
  };
  const { response, text } = yield* postForm(vendor, vendor.tokenUrl, sent);
  if (response.ok) {
    const payload = yield* Effect.try({
      try: () => parseVendorPayload(deviceGrantTokenSchema, text, `${vendor.label} token response`, sent),
      catch: oauthFailure,
    });
    return { status: 'ready', tokens: yield* normalizeTokens(vendor, payload) } satisfies DeviceGrantPoll;
  }
  const body = readOAuthError(text, sent);
  if (body.error === 'authorization_pending') return { status: 'pending', slowDown: false } satisfies DeviceGrantPoll;
  if (body.error === 'slow_down') return { status: 'pending', slowDown: true } satisfies DeviceGrantPoll;
  if (body.error === 'access_denied' || body.error === 'authorization_denied') {
    return yield* new OAuthFlowFailed({ reason: `${vendor.label} device authorization was denied` });
  }
  if (body.error === 'expired_token') {
    return yield* new OAuthFlowFailed({ reason: `${vendor.label} device code expired — start the sign-in again` });
  }
  const detail = body.error_description ?? body.error ?? '';
  return yield* new OAuthFlowFailed({
    reason: `${vendor.label} device token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`,
  });
});

export function pollDeviceGrantOnce(vendor: DeviceGrantVendor, device: Pick<DeviceAuthorization, 'deviceCode'>): Promise<DeviceGrantPoll> {
  return runFlow(deviceGrantPoll(vendor, device));
}

export type DeviceGrantApprovalOptions = { readonly signal?: AbortSignal };

export const deviceGrantApproval = Effect.fn('DeviceGrant.approval')(function* (
  vendor: DeviceGrantVendor,
  device: DeviceAuthorization,
  options: DeviceGrantApprovalOptions = {},
) {
  const loop = Effect.gen(function* () {
    let intervalMs = device.intervalMs;
    while ((yield* Clock.currentTimeMillis) < device.expiresAt) {
      const result = yield* deviceGrantPoll(vendor, device);
      if (result.status === 'ready') return result.tokens;
      if (result.slowDown) intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
      const remaining = Math.max(0, device.expiresAt - (yield* Clock.currentTimeMillis));
      yield* Effect.sleep(Duration.millis(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining)));
    }
    return yield* new OAuthFlowFailed({ reason: `${vendor.label} device authorization timed out` });
  });
  const signal = options.signal;
  if (!signal) return yield* loop;
  return yield* Effect.raceFirst(loop, deviceGrantCancelled(vendor, signal));
});

function deviceGrantCancelled(vendor: DeviceGrantVendor, signal: AbortSignal): Effect.Effect<never, OAuthFlowFailed> {
  return Effect.callback<never, OAuthFlowFailed>((resume) => {
    const fire = () => resume(Effect.fail(new OAuthFlowFailed({ reason: `${vendor.label} device authorization cancelled` })));
    if (signal.aborted) return fire();
    signal.addEventListener('abort', fire, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', fire));
  });
}

export function completeDeviceGrant(
  vendor: DeviceGrantVendor,
  device: DeviceAuthorization,
  options: DeviceGrantApprovalOptions = {},
): Promise<DeviceGrantTokens> {
  return runFlow(deviceGrantApproval(vendor, device, options));
}

export const deviceGrantRefresh = Effect.fn('DeviceGrant.refresh')(function* (vendor: DeviceGrantVendor, refreshToken: string) {
  if (!refreshToken.trim()) {
    return yield* new OAuthFlowFailed({ reason: `${vendor.label} refresh token is empty` });
  }
  const sent = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: vendor.clientId,
  };
  const { response, text } = yield* postForm(vendor, vendor.tokenUrl, sent);
  if (!response.ok) {
    return yield* new OAuthFlowFailed({
      reason: `${vendor.label} token refresh failed (${response.status}): ${readableVendorAnswer(text.trim(), sent) || response.statusText}`,
    });
  }
  const payload = yield* Effect.try({
    try: () => parseVendorPayload(deviceGrantTokenSchema, text, `${vendor.label} token response`, sent),
    catch: oauthFailure,
  });
  return yield* normalizeTokens(vendor, payload, refreshToken);
});

export function refreshDeviceGrantTokens(vendor: DeviceGrantVendor, refreshToken: string): Promise<DeviceGrantTokens> {
  return runFlow(deviceGrantRefresh(vendor, refreshToken));
}

const normalizeTokens = Effect.fnUntraced(function* (
  vendor: DeviceGrantVendor,
  raw: DeviceGrantTokenPayload,
  fallbackRefresh?: string,
): Effect.fn.Return<DeviceGrantTokens, OAuthFlowFailed> {
  const accessToken = (raw.access_token ?? '').trim();
  if (!accessToken) {
    return yield* new OAuthFlowFailed({ reason: `${vendor.label} token response missing access_token` });
  }
  const refreshToken = (raw.refresh_token ?? fallbackRefresh ?? (vendor.refreshOptional ? accessToken : '')).trim();
  if (!refreshToken) {
    return yield* new OAuthFlowFailed({ reason: `${vendor.label} token response missing refresh_token` });
  }
  const expiresInSeconds = typeof raw.expires_in === 'number' && raw.expires_in > 0 ? raw.expires_in : 3600;
  return {
    accessToken,
    refreshToken,
    expiresAt: (yield* Clock.currentTimeMillis) + expiresInSeconds * 1000,
    scope: (raw.scope ?? '').trim(),
    idToken: (raw.id_token ?? '').trim() || undefined,
  };
});

function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs;
}

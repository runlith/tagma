import { Effect, Schema } from 'effect';
import { ROTATING_GRANT } from '@runlith/llm/models/grant';
import { SINGLE_ACCOUNT_KEY } from '@runlith/llm/oauth/accountKey';
import { type DeviceGrantVendor, deviceGrantTokensToStored } from '@runlith/llm/oauth/flows/deviceGrant';
import { subscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { unsupportedQuota } from '@runlith/llm/profiles/quotaRead';
import { defineAdapter } from '@runlith/tagma/adapter/provider';

export const DEVICE_PROVIDER = 'device-fixture';

export const DEVICE_GRANT: DeviceGrantVendor = {
  label: 'Device fixture',
  clientId: 'device-fixture',
  deviceAuthorizationUrl: 'https://device.invalid/device/code',
  tokenUrl: 'https://device.invalid/token',
  headers: () => ({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }),
};

const DeviceCredential = Schema.Struct({ ...ROTATING_GRANT, scope: Schema.String });

export const adapter = defineAdapter(() => [
  {
    id: DEVICE_PROVIDER,
    label: 'Device fixture',
    kind: 'wire',
    auth: 'oauth',
    models: {
      'device-1': { label: 'Device 1', capacity: { context: 100_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
    },
    cacheLifetime: { promisedSeconds: null, prior: null },
    defaultTextModel: 'device-1',
    profile: {
      model: () => Effect.die(new Error('the device fixture serves no model')),
      options: () => undefined,
      output: { budget: 1_000, sent: true },
    },
    quota: { fromHeaders: () => null, read: unsupportedQuota },
    accounts: subscriptionAccounts({
      credential: DeviceCredential,
      signIns: [{ kind: 'device', vendor: DEVICE_GRANT, store: (tokens) => Effect.succeed(deviceGrantTokensToStored(tokens)) }],
      key: () => SINGLE_ACCOUNT_KEY,
      label: () => 'Device fixture',
    }),
  },
]);

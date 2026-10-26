import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson } from '@runlith/llm/oauth/cliStore';
import type { ProviderQuota } from '@runlith/llm/profiles/contract';
import { quotaPost } from '@runlith/llm/profiles/quotaRead';
import * as Auth from '@runlith/llm/route/auth';
import { QuotaInvalidResponse, QuotaObservation, QuotaTransportFailure, QuotaUnavailable, QuotaWindow } from '@runlith/llm/schema/quota';
import { Clock, Effect, Schema } from 'effect';
import { credentialSchema } from './accounts';

const cliCredential = Schema.Struct({ accessToken: Schema.optional(Schema.String) });
const cliIdentity = Schema.Struct({ email: Schema.String });
const usageSchema = Schema.Struct({
  billingCycleEnd: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  planUsage: Schema.optional(
    Schema.Struct({
      totalPercentUsed: Schema.optional(Schema.Number),
      autoPercentUsed: Schema.optional(Schema.Number),
      apiPercentUsed: Schema.optional(Schema.Number),
    }),
  ),
});

const tokenFromKeychain = Effect.tryPromise({
  try: (signal) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'cursor-access-token', '-a', 'cursor-user', '-w'],
        { encoding: 'utf8', signal },
        (error, stdout) => {
          if (error === null) resolve(stdout.trim());
          else if (error.code === 44) reject(new QuotaUnavailable({ reason: 'cursor-agent is not signed in on this machine.' }));
          else reject(new QuotaTransportFailure({ message: `Cursor CLI Keychain could not be read: ${error.message}` }));
        },
      );
    }),
  catch: (cause) =>
    cause instanceof QuotaUnavailable || cause instanceof QuotaTransportFailure
      ? cause
      : new QuotaTransportFailure({ message: String(cause) }),
});

const cliToken = Effect.fn('cursor.cliToken')(function* () {
  if (process.env.AGENT_CLI_CREDENTIAL_STORE === 'memory')
    return yield* new QuotaUnavailable({ reason: 'cursor-agent keeps no persistent login on this machine.' });
  if (process.platform === 'darwin' && process.env.AGENT_CLI_CREDENTIAL_STORE !== 'file') return yield* tokenFromKeychain;
  const home = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) ?? homedir();
  const directory =
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Cursor')
      : process.platform === 'darwin'
        ? join(home, '.cursor')
        : join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'cursor');
  const stored = yield* readJson('cursor', join(directory, 'auth.json')).pipe(
    Effect.mapError((cause) => new QuotaTransportFailure({ message: cause.message })),
  );
  if (stored === null) return yield* new QuotaUnavailable({ reason: 'cursor-agent is not signed in on this machine.' });
  const credential = yield* Schema.decodeUnknownEffect(cliCredential)(stored).pipe(
    Effect.mapError((cause) => new QuotaInvalidResponse({ message: cause.message })),
  );
  if (!credential.accessToken) return yield* new QuotaUnavailable({ reason: 'cursor-agent is not signed in on this machine.' });
  return credential.accessToken;
});

const dashboard = (method: string, token: string) =>
  quotaPost({
    url: `https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`,
    body: {},
    auth: Auth.bearer(token),
    headers: { 'connect-protocol-version': '1', 'x-cursor-client-type': 'cli' },
  });

export const quota: ProviderQuota = {
  fromHeaders: () => null,
  read: Effect.fn('cursor.quota')(function* (credentials, ownerId, account) {
    const stored = yield* Effect.tryPromise({
      try: () => credentials.credential(ownerId, 'cursor', account),
      catch: (cause) => new QuotaTransportFailure({ message: String(cause) }),
    });
    const credential = yield* Schema.decodeUnknownEffect(credentialSchema)(stored).pipe(
      Effect.mapError((cause) => new QuotaInvalidResponse({ message: cause.message })),
    );
    const token = yield* cliToken();
    const identity = yield* Schema.decodeUnknownEffect(cliIdentity)((yield* dashboard('GetMe', token)).body).pipe(
      Effect.mapError((cause) => new QuotaInvalidResponse({ message: cause.message })),
    );
    if (identity.email.trim().toLowerCase() !== credential.email.trim().toLowerCase())
      return yield* new QuotaUnavailable({ reason: `cursor-agent is signed in as ${identity.email}, not ${credential.email}.` });
    const reply = yield* dashboard('GetCurrentPeriodUsage', token);
    const usage = yield* Schema.decodeUnknownEffect(usageSchema)(reply.body).pipe(
      Effect.mapError((cause) => new QuotaInvalidResponse({ message: cause.message })),
    );
    const resets = Number(usage.billingCycleEnd);
    const labels = { totalPercentUsed: 'Plan', autoPercentUsed: 'Cursor models', apiPercentUsed: 'Other models' } as const;
    const windows = Object.entries(usage.planUsage ?? {}).flatMap(([id, usedPercent]) =>
      usedPercent === undefined
        ? []
        : [
            new QuotaWindow({
              kind: 'monthly',
              label: labels[id as keyof typeof labels],
              usedPercent,
              resetsAt: Number.isFinite(resets) && resets > 0 ? resets / 1_000 : undefined,
            }),
          ],
    );
    if (windows.length === 0) return yield* new QuotaUnavailable({ reason: 'Cursor returned no plan usage windows.' });
    return new QuotaObservation({ source: 'usage', observedAt: new Date(yield* Clock.currentTimeMillis), windows });
  }),
};

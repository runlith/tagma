import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClient } from 'effect/http';
import { answering } from '@runlith/llm/route/transport/answering';
import { deviceGrantTokensToStored, type ScopedGrant } from '@runlith/llm/oauth/flows/deviceGrant';
import { makeProviderSignIn, ProviderSignInPendingError } from '@runlith/llm/oauth/ProviderSignIn';
import type { DeviceSignIn } from '@runlith/llm/oauth/vendor';

const PROVIDER = 'fixture-oauth';

const flow: DeviceSignIn<ScopedGrant> = {
  kind: 'device',
  vendor: {
    label: 'Fixture',
    clientId: 'fixture',
    deviceAuthorizationUrl: 'https://auth.test/device',
    tokenUrl: 'https://auth.test/token',
    scope: 'api',
    headers: () => ({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }),
  },
  store: (tokens) => Effect.succeed(deviceGrantTokensToStored(tokens)),
};

const signInHere = (responses: Array<() => Response>) => {
  let at = 0;
  const wire = HttpClient.layerMergedContext(Effect.succeed(answering(() => responses[Math.min(at++, responses.length - 1)]!())));
  return makeProviderSignIn({ wire });
};

const grant = (uri: string) => () =>
  Response.json({ device_code: 'device-code', user_code: 'USER-CODE', verification_uri: uri, expires_in: 300, interval: 5 });
const approved = () => Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'api' });

it.effect('a device poll still waiting fails as ProviderSignInPendingError, and approval completes', () =>
  Effect.gen(function* () {
    const signIn = signInHere([
      grant('https://auth.test/activate'),
      () => Response.json({ error: 'authorization_pending' }, { status: 400 }),
      approved,
    ]);
    const begun = yield* signIn.begin('operator', PROVIDER, flow);
    expect(begun.flow).toBe('device');
    yield* TestClock.adjust(5_000);
    const pending = yield* Effect.flip(signIn.complete('operator', PROVIDER, flow));
    expect(pending).toBeInstanceOf(ProviderSignInPendingError);
    yield* TestClock.adjust(5_000);
    const credential = yield* signIn.complete('operator', PROVIDER, flow);
    expect(credential.accessToken).toBe('access');
  }),
);

it.effect('the vendor is polled no sooner than its interval, and a slow_down lengthens it', () =>
  Effect.gen(function* () {
    const signIn = signInHere([
      grant('https://auth.test/activate'),
      () => Response.json({ error: 'slow_down' }, { status: 400 }),
      approved,
    ]);
    yield* signIn.begin('operator', PROVIDER, flow);
    const slowed = yield* Effect.flip(signIn.complete('operator', PROVIDER, flow));
    expect(slowed).toMatchObject({ slowDown: true });
    yield* TestClock.adjust(5_000);
    const held = yield* Effect.flip(signIn.complete('operator', PROVIDER, flow));
    expect(held).toBeInstanceOf(ProviderSignInPendingError);
    yield* TestClock.adjust(5_000);
    expect((yield* signIn.complete('operator', PROVIDER, flow)).accessToken).toBe('access');
  }),
);

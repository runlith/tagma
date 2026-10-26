import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Fiber } from 'effect';
import { HttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { answering } from '../../llm/route/transport/answering';
import { type DeviceGrantVendor, deviceAuthorization, deviceGrantApproval, deviceGrantPoll, deviceGrantRefresh } from './deviceGrant';

const VENDOR: DeviceGrantVendor = {
  label: 'Test',
  clientId: 'client',
  deviceAuthorizationUrl: 'https://auth.test/device',
  tokenUrl: 'https://auth.test/token',
  headers: () => ({ 'Content-Type': 'application/x-www-form-urlencoded' }),
};

const DEVICE = {
  deviceCode: 'device-code',
  userCode: 'USER-CODE',
  verificationUri: 'https://auth.test/activate',
  expiresAt: 60_000,
  intervalMs: 5_000,
};

const respondInTurn = (responses: Array<() => Response>) => {
  let at = 0;
  return {
    polls: () => at,
    wire: HttpClient.layerMergedContext(
      Effect.succeed(answering(() => (responses[Math.min(at++, responses.length - 1)] as () => Response)())),
    ),
  };
};

const pending = (error: string) => () => Response.json({ error }, { status: 400 });

const approved = () => Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'api' });

it.effect('raises the poll interval by five seconds for every slow_down, and not for authorization_pending', () => {
  const { polls, wire } = respondInTurn([pending('authorization_pending'), pending('slow_down'), pending('slow_down'), approved]);

  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(deviceGrantApproval(VENDOR, DEVICE));
    yield* TestClock.adjust(7_999);
    expect(polls()).toBe(1);
    yield* TestClock.adjust(1);
    expect(polls()).toBe(2);
    yield* TestClock.adjust(12_999);
    expect(polls()).toBe(2);
    yield* TestClock.adjust(1);
    expect(polls()).toBe(3);
    yield* TestClock.adjust(17_999);
    expect(polls()).toBe(3);
    yield* TestClock.adjust(1);
    const tokens = yield* Fiber.join(fiber);

    expect(tokens.accessToken).toBe('access');
  }).pipe(Effect.provide(wire));
});

it.effect('a device code and its approved tokens share the runtime clock', () =>
  Effect.gen(function* () {
    yield* TestClock.adjust('1 hour');
    const now = yield* Clock.currentTimeMillis;
    const device = yield* deviceAuthorization(VENDOR);
    expect(device.expiresAt).toBe(now + 300_000);
    const tokens = yield* deviceGrantApproval(VENDOR, device);
    expect(tokens.expiresAt).toBe(now + 3_600_000);
  }).pipe(
    Effect.provide(
      respondInTurn([
        () =>
          Response.json({
            device_code: 'device-code',
            user_code: 'USER-CODE',
            verification_uri: 'https://auth.test/activate',
            expires_in: 300,
          }),
        approved,
      ]).wire,
    ),
  ),
);

it.effect('one vendor token call times out at the package ceiling', () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.flip(deviceGrantPoll(VENDOR, DEVICE)));
    yield* Effect.yieldNow;
    yield* TestClock.adjust(9_999);
    expect(fiber.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust(1);
    const failure = yield* Fiber.join(fiber);

    expect(failure).toMatchObject({
      _tag: 'OAuthFlowFailed',
      reason: 'Test token exchange timed out after 10000ms',
    });
  }).pipe(Effect.provide(HttpClient.layerMergedContext(Effect.succeed(answering(() => new Promise<Response>(() => {})))))),
);

it.effect('floors a sub-second interval, keeps one written as a string, and refuses a garbage one', () => {
  const grant = (interval: unknown) => () =>
    Response.json({
      device_code: 'device-code',
      user_code: 'USER-CODE',
      verification_uri: 'https://auth.test/activate',
      interval,
    });

  return Effect.gen(function* () {
    expect((yield* deviceAuthorization(VENDOR)).intervalMs).toBe(1_000);
    expect((yield* deviceAuthorization(VENDOR)).intervalMs).toBe(7_000);
    expect(yield* Effect.flip(deviceAuthorization(VENDOR))).toMatchObject({ _tag: 'OAuthFlowFailed' });
  }).pipe(Effect.provide(respondInTurn([grant(0.5), grant('7'), grant('soon')]).wire));
});

it.effect('rejects a token response the endpoint never documents instead of reading undefined fields', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(deviceGrantPoll(VENDOR, DEVICE));
    expect(failure.message).toContain('Test token response is not JSON');
  }).pipe(Effect.provide(respondInTurn([() => new Response('<html>gateway timeout</html>', { status: 200 })]).wire)),
);

type RefusedGrant = { readonly body: string; readonly diagnostic: string };
const refusedGrants: readonly RefusedGrant[] = [
  { body: `refused: device_code=${DEVICE.deviceCode}`, diagnostic: 'not JSON' },
  { body: JSON.stringify({ error: { credential: DEVICE.deviceCode } }), diagnostic: 'invalid shape' },
];
for (const { body, diagnostic } of refusedGrants) {
  it.effect(`a refused grant preserves a redacted ${diagnostic} diagnostic`, () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(deviceGrantPoll(VENDOR, DEVICE));
      expect(failure._tag).toBe('OAuthFlowFailed');
      expect(failure.message).toContain(diagnostic);
      expect(failure.message).not.toContain(DEVICE.deviceCode);
    }).pipe(Effect.provide(respondInTurn([() => new Response(body, { status: 400 })]).wire)),
  );
}

it.effect('reads a device grant that rotates no refresh token as a failed sign-in', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(deviceGrantPoll(VENDOR, DEVICE));
    expect(failure.message).toContain('Test token response missing refresh_token');
  }).pipe(Effect.provide(respondInTurn([() => Response.json({ access_token: 'access', expires_in: 3600 })]).wire)),
);

it.effect('a refusal body echoing the posted refresh token reaches nobody', () => {
  const refreshToken = 'a-device-grant-refresh-token-worth-keeping';
  const { wire } = respondInTurn([
    () =>
      new Response(`refused: refresh_token=${refreshToken}&client_id=client`, {
        status: 400,
      }),
  ]);

  return Effect.gen(function* () {
    const failure = yield* Effect.flip(deviceGrantRefresh(VENDOR, refreshToken));

    expect(failure.message).not.toContain(refreshToken);
    expect(failure.message).toContain('<redacted>');
  }).pipe(Effect.provide(wire));
});

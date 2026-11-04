import { afterAll, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { type Session, SessionEnded } from '@runlith/cdp/session';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { CookieSources } from '../browser/contract/service/cookies.js';
import { type Host, HostAdapters, Hosts } from '../browser/contract/service/hosts.js';
import { Profiles } from '../browser/contract/service/profiles.js';
import { ProfileId } from '../browser/contract/wire/ids.js';
import { agentIn, COOKIE, calling, OPERATOR, PAGE, refusalOf } from '../browser/testing/world.js';
import { MANAGED_AGENT } from './adapter.js';
import { managedFixture, OTHER, testAdapter as adapter } from './testing/host.js';

const heard: (string | null)[] = [];
const server: Bun.Server<undefined> = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (request) => {
    heard.push(request.headers.get('cookie'));
    return new Response('<!doctype html><title>Echo</title>', { headers: { 'content-type': 'text/html' } });
  },
});

afterAll(() => server.stop(true));

const cut: { armed: 'fail' | 'hang' | null; hanging: Deferred.Deferred<void> } = { armed: null, hanging: Deferred.makeUnsafe() };

const breaking = (session: Session, how: 'fail' | 'hang'): Session => {
  let sets = 0;
  const send = ((method: string, ...args: never[]) =>
    method === 'Network.setCookies' && ++sets === 2
      ? how === 'fail'
        ? Effect.fail(new SessionEnded({ message: 'the test cut the session', end: 'lost', pending: true }))
        : Effect.andThen(Deferred.succeed(cut.hanging, undefined), Effect.never)
      : (session.send as (method: string, ...rest: never[]) => ReturnType<Session['send']>)(method, ...args)) as Session['send'];
  return { ...session, send };
};

const wrap = (host: Host): Host => ({
  ...host,
  profiles: {
    ...host.profiles,
    session: (profile) =>
      Effect.map(host.profiles.session(profile), (session) => {
        const how = cut.armed;
        if (how === null) return session;
        cut.armed = null;
        return breaking(session, how);
      }),
  },
});

const file = (name: string, entries: readonly object[]): string => {
  const path = join(tmpdir(), `managed-cookies-${name}.json`);
  writeFileSync(path, JSON.stringify(entries));
  return path;
};

const local = (name: string, value = 'v', extra: object = {}) => ({
  domain: '127.0.0.1',
  hostOnly: true,
  name,
  value,
  path: '/',
  ...extra,
});

const imported = (input: Parameters<(typeof COOKIE.import_cookies.body)['execute']>[0]) =>
  calling(COOKIE.import_cookies.body.execute(input, undefined, OPERATOR)).pipe(
    Effect.provide(Layer.mergeAll(Layer.succeed(CookieSources, { all: [] }), Layer.succeed(HostAdapters, { all: [adapter] }))),
  );

layer(managedFixture({}, wrap), {
  excludeTestServices: true,
})('cookie import into the managed host', (it) => {
  it.effect('cookie replacement rolls back failed and interrupted writes, serializes imports and carries sign-ins to another profile', () =>
    Effect.gen(function* () {
      const profiles = yield* Profiles;
      const hosts = yield* Hosts;
      const record = yield* profiles.record(MANAGED_AGENT);
      const inspection = yield* (yield* hosts.reach(record.adapter)).profiles.session(record);
      const standing = Effect.map(inspection.send('Network.getAllCookies'), (read) =>
        read.cookies.map((cookie) => `${cookie.domain} ${cookie.name}=${cookie.value}`).sort(),
      );
      yield* imported({
        profile: MANAGED_AGENT,
        file: file('first', [local('stale'), { domain: '.other.test', name: 'other', value: 'o', path: '/' }]),
      });
      const answer = yield* imported({
        profile: MANAGED_AGENT,
        file: file('second', [
          local('sid', 'signed-in', { httpOnly: true, sameSite: 'lax' }),
          local('bad', 'v', { sameSite: 'no_restriction', secure: false }),
          local('empty', ''),
          { domain: '.google.com', name: 'SID', value: 'g', path: '/', secure: true },
        ]),
      });
      expect([answer.written, answer.google, answer.rejected, answer.unreadable, answer.domains]).toEqual([2, 1, 1, 0, ['127.0.0.1']]);
      const after = yield* standing;
      expect(after).toEqual(['.other.test other=o', '127.0.0.1 empty=', '127.0.0.1 sid=signed-in']);

      cut.armed = 'fail';
      const many = Array.from({ length: 201 }, (_, index) => local(`bulk${index}`));
      const refused = yield* refusalOf(imported({ profile: MANAGED_AGENT, file: file('broken', many) }));
      expect(refused.code).toBe('import-broken');
      expect(yield* standing).toEqual(after);
      const carried = yield* imported({ profile: OTHER, from: MANAGED_AGENT });
      expect(carried.written).toBe(3);
      heard.length = 0;
      yield* calling(
        PAGE.open_page.body.execute({ url: `http://127.0.0.1:${server.port}/echo`, profile: OTHER }, undefined, agentIn(tmpdir())),
      );
      expect(heard[0]?.split('; ').sort()).toEqual(['empty=', 'sid=signed-in']);
      cut.armed = 'hang';
      const first = yield* Effect.forkChild(imported({ profile: MANAGED_AGENT, file: file('hanging', many) }));
      yield* Deferred.await(cut.hanging);
      const checkedRollback = standing.pipe(
        Effect.orDie,
        Effect.tap((cookies) =>
          Effect.sync(() => expect(cookies).toEqual(['.other.test other=o', '127.0.0.1 empty=', '127.0.0.1 sid=signed-in'])),
        ),
      );
      const queued = yield* Deferred.make<void>();
      const second = yield* Effect.forkChild(
        imported({ profile: MANAGED_AGENT, file: file('after', [local('fresh')]) }).pipe(
          Effect.provideService(
            Profiles,
            Profiles.of({
              ...profiles,
              exclusive: Effect.fnUntraced(function* <A, E, R>(profile: ProfileId, work: Effect.Effect<A, E, R>) {
                const pending = yield* Effect.forkChild(profiles.exclusive(profile, Effect.andThen(checkedRollback, work)), {
                  startImmediately: true,
                });
                yield* Deferred.succeed(queued, undefined);
                return yield* Fiber.join(pending);
              }),
            }),
          ),
        ),
      );
      yield* Deferred.await(queued);
      yield* Fiber.interrupt(first);
      expect((yield* Fiber.join(second)).written).toBe(1);
      expect(yield* standing).toEqual(['.other.test other=o', '127.0.0.1 fresh=v']);
    }),
  );
});

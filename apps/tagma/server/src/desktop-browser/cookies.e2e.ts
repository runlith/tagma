import { afterAll, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { CookieSources } from '../browser/contract/service/cookies.js';
import { HostAdapters, Hosts } from '../browser/contract/service/hosts.js';
import { Profiles } from '../browser/contract/service/profiles.js';
import { AGENT_PROFILE } from '../browser/contract/wire/ids.js';
import { agentIn, COOKIE, calling, OPERATOR, PAGE } from '../browser/testing/world.js';
import { desktopAdapter } from './adapter.js';
import { desktopFixture } from './testing/electron.js';

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
layer(desktopFixture(), {
  excludeTestServices: true,
})('cookie import into a desktop profile', (it) => {
  it.effect(
    'an import writes the partition of the desktop profile, keeps partition keys, counts what the store refuses, and the pages of the profile send the cookies',
    () =>
      Effect.gen(function* () {
        const home = mkdtempSync(join(tmpdir(), 'desktop-cookies-'));
        const file = join(home, 'cookies.json');
        writeFileSync(
          file,
          JSON.stringify([
            { domain: '127.0.0.1', hostOnly: true, name: 'sid', value: 'signed-in', path: '/', httpOnly: true, sameSite: 'lax' },
            { domain: '127.0.0.1', hostOnly: true, name: 'bad', value: 'v', path: '/', sameSite: 'no_restriction', secure: false },
            {
              domain: 'embed.example.net',
              hostOnly: true,
              name: '__Host-chip',
              value: 'c',
              path: '/',
              secure: true,
              sameSite: 'no_restriction',
              partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true },
            },
          ]),
        );
        const answer = yield* calling(COOKIE.import_cookies.body.execute({ profile: AGENT_PROFILE, file }, undefined, OPERATOR)).pipe(
          Effect.provide(Layer.mergeAll(Layer.succeed(CookieSources, { all: [] }), Layer.succeed(HostAdapters, { all: [desktopAdapter] }))),
        );
        expect([answer.written, answer.rejected]).toEqual([2, 1]);

        const stored = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* (yield* Profiles).record(AGENT_PROFILE);
            const host = yield* (yield* Hosts).reach(record.adapter);
            return (yield* (yield* host.profiles.session(record)).send('Network.getAllCookies')).cookies;
          }),
        );
        expect(stored.find((cookie) => cookie.name === '__Host-chip')?.partitionKey).toEqual({
          topLevelSite: 'https://top.example',
          hasCrossSiteAncestor: true,
        });

        heard.length = 0;
        yield* calling(
          PAGE.open_page.body.execute({ url: `http://127.0.0.1:${server.port}/echo`, profile: AGENT_PROFILE }, undefined, agentIn(home)),
        );
        expect(heard[0]).toBe('sid=signed-in');
      }),
  );
});

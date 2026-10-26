import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, type Result } from 'effect';
import { dockerSuite } from '../../../sandbox/testing/doubles.js';
import { failureOf, preparedTreeFixture, PreparedTreeFixture, REGISTRY } from '../preparedTreeFixture.js';

const said = <A, E>(result: Result.Result<A, E>): string => {
  const message = failureOf(result);
  const cut = message.lastIndexOf(' failed: ');
  return cut < 0 ? message : message.slice(cut + ' failed: '.length);
};
const probes = [
  `bun -e 'fetch("https://example.com/").then(async (r) => console.log("FOREIGN status=" + r.status + " bytes=" + (await r.text()).length)).catch((e) => console.log("FOREIGN error=" + (e.code || e.name)))'`,
  `bun -e 'Bun.connect({hostname:"1.1.1.1",port:443,socket:{data(){}}}).then(() => console.log("SOCKET open")).catch((e) => console.log("SOCKET error=" + (e.code || e.name)))'`,
  `bun -e 'require("node:dns").promises.resolve4("example.com").then((a) => console.log("DNS addresses=" + a)).catch((e) => console.log("DNS error=" + (e.code || e.name)))'`,
  'exit 7',
].join('; ');

dockerSuite('prepared-tree network', () => {
  layer(preparedTreeFixture(), { excludeTestServices: true, timeout: '60 seconds' })('resources', (it) => {
    it.effect(
      'a build cannot reach an ungranted host, raw socket or DNS',
      () =>
        PreparedTreeFixture.use((world) =>
          Effect.gen(function* () {
            const met = said(yield* world.build({ network: [REGISTRY], setup: [probes] }));
            expect(met, met).toContain('FOREIGN status=403 bytes=0');
            expect(met, met).not.toContain('SOCKET open');
            expect(met, met).toContain('SOCKET error=');
            expect(met, met).not.toContain('DNS addresses=');
            expect(met, met).toContain('DNS error=');
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'a build with no grant gets no network and records its failed preparation',
      () =>
        PreparedTreeFixture.use((world) =>
          Effect.gen(function* () {
            const refused = yield* world.build({
              setup: [
                `bun -e 'fetch("https://${REGISTRY}/typescript").then((r) => console.log("GRANTED status=" + r.status)).catch((e) => console.log("GRANTED error=" + (e.code || e.name)))'; exit 7`,
              ],
            });
            const met = said(refused);
            expect(met, met).not.toContain('GRANTED status=');
            expect(met, met).toContain('GRANTED error=');
            const failed = (yield* world.store.standing()).find(
              (row) => row.state === 'failed' && row.failureReason?.includes('GRANTED error='),
            );
            expect(failed?.manifest).toBeNull();
            expect(failed?.resourcesReleased).toBe(true);
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );
  });
});

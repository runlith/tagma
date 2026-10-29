import { expect } from 'bun:test';
import { Effect, Fiber, Stream } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { Pages } from '../contract/service/pages.js';
import { NETWORKS } from '../contract/wire/emulation.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import type { PagesEvent } from '../contract/wire/page.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { RunEnds } from './runs.js';
import { calling, OPERATOR, refusalOf } from './world.js';

const LOOP = `(iterations = 5000000) => { let value = 0; const start = performance.now(); for (let i = 0; i < iterations; i++) value = (Math.imul(value, 1664525) + i) | 0; window.loopValue = value; return performance.now() - start; }`;
export const BENCHMARK = `<!doctype html><title>Conditions</title><script>
window.measure = ${LOOP};
addEventListener('message', event => { if (event.data === 'measure') parent.postMessage({ elapsed: measure() }, '*'); });
parent.postMessage('ready', '*');
</script>`;

export const refusedConditionScenario = Effect.fnUntraced(function* (profile: ProfileId, caller: Caller) {
  const pages = yield* Pages;
  const { page } = yield* calling(PAGE.open_page.body.execute({ profile }, undefined, OPERATOR));
  yield* Effect.addFinalizer(() => pages.close(page.id).pipe(Effect.orDie));
  const measured = () =>
    calling(
      PAGE.evaluate_in_page.body.execute(
        { page: page.id, expression: '[innerWidth, innerHeight, navigator.userAgent]' },
        undefined,
        caller,
      ),
    ).pipe(Effect.map((answer) => ('value' in answer ? (JSON.parse(answer.value) as unknown) : answer.exception)));
  const before = yield* measured();
  const refused = yield* refusalOf(
    calling(
      PAGE.emulate_page.body.execute(
        { page: page.id, device: 'iphone-15', geolocation: { latitude: 10, longitude: 20 } },
        undefined,
        caller,
      ),
    ),
  );
  expect(refused.code).toBe('host-refused');
  yield* calling(PAGE.emulate_page.body.execute({ page: page.id, clear: true }, undefined, caller));
  expect(yield* measured()).toEqual(before);
});

export const conditionScenario = Effect.fnUntraced(function* (input: {
  readonly page: PageId;
  readonly profile: ProfileId;
  readonly url: string;
  readonly caller: Caller;
}) {
  const { page, profile, url, caller } = input;
  const pages = yield* Pages;
  const evaluate = (expression: string) =>
    calling(PAGE.evaluate_in_page.body.execute({ page, expression }, undefined, caller)).pipe(
      Effect.map((answer) => {
        if ('exception' in answer) throw new Error(answer.exception);
        return answer.value === 'undefined' ? undefined : (JSON.parse(answer.value) as unknown);
      }),
    );
  const emulate = (change: Parameters<typeof PAGE.emulate_page.body.execute>[0]) =>
    calling(PAGE.emulate_page.body.execute({ page, ...change }, undefined, caller));
  const other = yield* calling(PAGE.open_page.body.execute({ url, profile }, undefined, OPERATOR));
  yield* Effect.addFinalizer(() => pages.close(other.page.id).pipe(Effect.orDie));
  const otherValue = (expression: string) =>
    calling(PAGE.evaluate_in_page.body.execute({ page: other.page.id, expression }, undefined, OPERATOR)).pipe(
      Effect.map((answer) => ('value' in answer ? (JSON.parse(answer.value) as unknown) : answer.exception)),
    );
  const framed = `new Promise(resolve => { const frame = document.createElement('iframe'); frame.id = 'bench'; const ready = event => { if (event.source !== frame.contentWindow || event.data !== 'ready') return; removeEventListener('message', ready); resolve(true); }; addEventListener('message', ready); frame.src = ${JSON.stringify(url.replace('127.0.0.1', 'localhost'))}; document.body.append(frame); })`;
  const child = `new Promise(resolve => { const frame = document.getElementById('bench'); const measured = event => { if (event.source !== frame.contentWindow || !event.data.elapsed) return; removeEventListener('message', measured); resolve(event.data.elapsed); }; addEventListener('message', measured); frame.contentWindow.postMessage('measure', '*'); })`;
  yield* evaluate('measure()');
  const baseline = (yield* evaluate('measure()')) as number;
  yield* evaluate(framed);
  yield* evaluate(child);
  const childBaseline = (yield* evaluate(child)) as number;
  expect((yield* emulate({ cpu: 6 })).emulation.cpu).toBe(6);
  const slowed = (yield* evaluate('measure()')) as number;
  const childSlowed = (yield* evaluate(child)) as number;
  yield* evaluate(`document.getElementById('bench').remove()`);
  yield* evaluate(framed);
  const laterChildSlowed = (yield* evaluate(child)) as number;
  yield* emulate({ cpu: 20 });
  const owner = pages.inProfile(profile).find((held) => held.id === page);
  if (owner === undefined) return yield* Effect.die('the condition page was not recorded');
  const changes = yield* pages.changes(owner.projectId);
  const sharing = yield* Effect.forkScoped(
    Stream.runHead(
      Stream.filter(
        changes,
        (event): event is Extract<PagesEvent, { readonly type: 'put' }> => event.type === 'put' && event.page.opener === page,
      ),
    ),
  );
  yield* evaluate(`window.identity = 'same target'; window.open(${JSON.stringify(url)}, ${JSON.stringify(`strain-${page}`)}); true`);
  const opened = yield* Fiber.join(sharing);
  if (opened._tag === 'None') return yield* Effect.die('the shared-renderer popup was not recorded');
  const peer = opened.value.page.id;
  yield* Effect.addFinalizer(() => pages.close(peer).pipe(Effect.orDie));
  yield* calling(PAGE.wait_for_page.body.execute({ page: peer, until: 'load', timeoutMs: 120000 }, undefined, caller));
  const strainedAnswer = yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page: peer,
        expression: `(() => { const start = performance.now(); while (performance.now() - start < 6000) measure(100000); return performance.now() - start; })()`,
      },
      undefined,
      caller,
    ),
  );
  if ('exception' in strainedAnswer) return yield* Effect.die(strainedAnswer.exception);
  const strained = JSON.parse(strainedAnswer.value) as number;
  expect(pages.live(peer)?.responsive).toBe(true);
  expect(yield* evaluate('window.identity')).toBe('same target');
  expect(pages.live(page)?.responsive).toBe(true);
  yield* emulate({ cpu: 1, network: 'slow-3g' });
  const latency = yield* evaluate(
    `(async () => { const start = performance.now(); await fetch('/data?conditions', {cache:'no-store'}); return performance.now() - start; })()`,
  );
  expect(latency as number).toBeGreaterThanOrEqual(NETWORKS['slow-3g'].latency);
  yield* emulate({ network: 'offline' });
  expect(yield* evaluate(`fetch('/data?offline', {cache:'no-store'}).then(() => 'online', () => navigator.onLine)`)).toBe(false);
  expect(yield* otherValue('navigator.onLine')).toBe(true);
  yield* emulate({ network: null });
  expect(yield* evaluate(`fetch('/data?restored', {cache:'no-store'}).then(response => response.ok && navigator.onLine)`)).toBe(true);
  const permission = yield* evaluate(`navigator.permissions.query({name:'geolocation'}).then(permission => permission.state)`);
  yield* emulate({ geolocation: { latitude: 51.5, longitude: -0.12, accuracy: 8 } });
  expect(
    yield* evaluate(
      `new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve([position.coords.latitude, position.coords.longitude, position.coords.accuracy]), reject))`,
    ),
  ).toEqual([51.5, -0.12, 8]);
  yield* calling(PAGE.navigate_page.body.execute({ page, url: url.replace('127.0.0.1', 'localhost') }, undefined, caller));
  yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'load', timeoutMs: 120000 }, undefined, caller));
  expect(yield* evaluate(`navigator.permissions.query({name:'geolocation'}).then(permission => permission.state)`)).toBe('granted');
  expect(
    yield* evaluate(
      `new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve([position.coords.latitude, position.coords.longitude]), reject))`,
    ),
  ).toEqual([51.5, -0.12]);
  yield* emulate({ geolocation: null });
  expect(yield* evaluate(`navigator.permissions.query({name:'geolocation'}).then(permission => permission.state)`)).toBe(permission);
  yield* emulate({ cpu: 6, network: 'fast-4g', geolocation: { latitude: 10, longitude: 20 } });
  const endingSlowed = (yield* evaluate('measure()')) as number;
  const moves = yield* pages.moves(page);
  yield* (yield* RunEnds).end('agent');
  if (pages.live(page)?.conditions.cpu !== 1) yield* Stream.runHead(Stream.filter(moves, (move) => move.live.conditions.cpu === 1));
  expect(pages.live(page)?.conditions).toEqual({ cpu: 1, network: null, geolocation: null });
  const resumed = (yield* evaluate('measure()')) as number;
  console.log(
    JSON.stringify({
      conditions: {
        baseline,
        slowed,
        childBaseline,
        childSlowed,
        laterChildSlowed,
        endingSlowed,
        resumed,
        strained,
        latency,
        otherPageOnlineDuringOffline: true,
      },
    }),
  );
});

import { expect } from 'bun:test';
import { Deferred, Effect, Exit, Result, Stream } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Hosts } from '../contract/service/hosts.js';
import { Pages } from '../contract/service/pages.js';
import { Profiles } from '../contract/service/profiles.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import { allowedDomains, blockedDomains } from '../contract/wire/settings.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { calling, OPERATOR, refIn, refusalOf, Seeded } from './world.js';

const denied = Effect.fnUntraced(function* <A, E, R, W, RW>(
  work: Effect.Effect<A, E, R>,
  watch: Effect.Effect<Effect.Effect<unknown>, W, RW>,
  reached: Deferred.Deferred<void>,
) {
  const waiting = Effect.gen(function* () {
    const blocked = yield* watch;
    return yield* Effect.matchEffect(work, {
      onFailure: (failure) =>
        failure instanceof GateRefusal && failure.code === 'domain-blocked' ? Effect.succeed(Result.fail(failure)) : Effect.fail(failure),
      onSuccess: (answer) => Effect.as(blocked, Result.succeed(answer)),
    });
  });
  return yield* Effect.scoped(
    Effect.raceFirst(waiting, Deferred.await(reached).pipe(Effect.andThen(Effect.die('a forbidden document reached the fixture')))),
  );
});

export const domainFixture = () => {
  const visits: string[] = [];
  const reached = Deferred.makeUnsafe<void>();
  return {
    visits,
    reached,
    respond: (url: URL, port: number): Response | null => {
      if (url.pathname === '/domain-forbidden') {
        visits.push(url.hostname);
        Deferred.doneUnsafe(reached, Exit.void);
        return new Response('<!doctype html><title>Restricted destination</title><p>Restricted destination</p>', {
          headers: { 'content-type': 'text/html', 'access-control-allow-origin': '*' },
        });
      }
      if (url.pathname === '/domain-redirect') return Response.redirect(`http://blocked.localhost:${port}/domain-forbidden`);
      if (url.pathname !== '/domains') return null;
      return new Response(
        `<!doctype html><title>Domains</title>
        <a href="http://blocked.localhost:${port}/domain-forbidden">Blocked link</a>
        <button onclick="const f=document.createElement('iframe');f.src='http://blocked.localhost:${port}/domain-forbidden';document.body.append(f)">Blocked frame</button>
        <button onclick="window.open('http://blocked.localhost:${port}/domain-forbidden','oauth','popup')">Blocked popup</button>
        <button onclick="fetch('http://blocked.localhost:${port}/domain-forbidden').then(r=>r.text()).then(()=>document.getElementById('resource').textContent='Resource fetched')">Fetch resource</button>
        <output id="resource"></output>`,
        { headers: { 'content-type': 'text/html' } },
      );
    },
  };
};

export const domainScenario = Effect.fnUntraced(function* (input: {
  readonly page: PageId;
  readonly profile: ProfileId;
  readonly url: string;
  readonly caller: Caller;
  readonly visits: readonly string[];
  readonly reached: Deferred.Deferred<void>;
}) {
  const { page, profile, url, caller, visits } = input;
  const settings = yield* Settings;
  const seeded = yield* Seeded;
  const pages = yield* Pages;
  const oldBlocked = yield* settings.read(blockedDomains, seeded.id);
  const oldAllowed = yield* settings.read(allowedDomains, seeded.id);
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      [
        { key: blockedDomains.id, scope: 'user' as const, value: oldBlocked.layers.user?.value },
        { key: blockedDomains.id, scope: 'project' as const, value: oldBlocked.layers.project?.value },
        { key: allowedDomains.id, scope: 'user' as const, value: oldAllowed.layers.user?.value },
        { key: allowedDomains.id, scope: 'project' as const, value: oldAllowed.layers.project?.value },
      ],
      (write) => settings.write({ ...write, projectId: seeded.id }).pipe(Effect.orDie),
      { discard: true },
    ),
  );
  const write = (key: string, value: readonly string[] | undefined, scope: 'user' | 'project' = 'user') =>
    settings.write({ key, value, scope, projectId: seeded.id });
  const navigate = (address: string, actor = caller) => calling(PAGE.navigate_page.body.execute({ page, url: address }, undefined, actor));
  const snapshot = calling(PAGE.snapshot_page.body.execute({ page }, undefined, caller)).pipe(Effect.map((shot) => shot.text));
  const click = (ref: string) => calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref }] }, undefined, caller));
  const forbidden = url.replace('127.0.0.1', 'blocked.localhost').replace('/domains', '/domain-forbidden');
  const before = visits.length;
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const remaining = yield* pages.list(seeded.id, { closed: false, limit: 100, after: null }).pipe(Effect.orDie);
      for (const popup of remaining.pages) if (popup.opener === page) yield* pages.close(popup.id).pipe(Effect.orDie);
    }),
  );
  const opened = yield* pages.changes(seeded.id);
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      { page, expression: "window.name = 'source'; window.open('about:blank', 'retained'); true" },
      undefined,
      caller,
    ),
  );
  const retained = yield* Stream.runHead(
    opened.pipe(
      Stream.flatMap((event) => Stream.fromIterable(event.type === 'list' ? event.pages : event.type === 'put' ? [event.page] : [])),
      Stream.filter((popup) => popup.opener === page),
    ),
  );
  if (retained._tag === 'None') return yield* Effect.die('the named popup closed before adoption');
  const other = yield* calling(PAGE.open_page.body.execute({ profile }, undefined, OPERATOR));
  yield* Effect.addFinalizer(() => pages.close(other.page.id).pipe(Effect.orDie));
  yield* write(blockedDomains.id, ['*.localhost']);
  yield* write(allowedDomains.id, ['127.0.0.1', '*.localhost']);
  yield* calling(PAGE.evaluate_in_page.body.execute({ page: other.page.id, expression: '0' }, undefined, caller));
  const result = yield* Effect.result(navigate(forbidden));
  expect(result._tag).toBe('Failure');
  if (result._tag !== 'Failure') return;
  expect(result.failure).toMatchObject({ code: 'domain-blocked' });
  expect(result.failure.message).toContain('blocked.localhost');
  expect(result.failure.message).toContain(blockedDomains.id);
  expect(visits.length).toBe(before);
  const record = yield* (yield* Profiles).record(profile);
  const host = yield* (yield* Hosts).reach(record.adapter);
  const watch = Effect.fnUntraced(function* (target: PageId) {
    yield* calling(PAGE.evaluate_in_page.body.execute({ page: target, expression: '0' }, undefined, caller));
    const events = yield* host.pages.events;
    return Stream.runHead(Stream.filter(events, (event) => event.kind === 'navigation-blocked' && event.page === target)).pipe(
      Effect.flatMap((event) =>
        event._tag === 'Some' ? Effect.void : Effect.die('the host event stream ended before a navigation block'),
      ),
    );
  });
  const reuseOutcome = yield* denied(
    calling(
      PAGE.evaluate_in_page.body.execute(
        {
          page,
          expression: `window.open(${JSON.stringify(forbidden)}, 'retained'); true`,
        },
        undefined,
        caller,
      ),
    ),
    watch(page),
    input.reached,
  );
  const reuseFailure =
    reuseOutcome._tag === 'Failure'
      ? reuseOutcome.failure
      : yield* Effect.flip(calling(PAGE.evaluate_in_page.body.execute({ page, expression: '0' }, undefined, caller)));
  expect(reuseFailure).toMatchObject({ code: 'domain-blocked' });
  const acknowledged = yield* calling(PAGE.evaluate_in_page.body.execute({ page, expression: '0' }, undefined, caller));
  expect('value' in acknowledged ? acknowledged.value : acknowledged.exception).toBe('0');
  const operatorTarget = forbidden.replace('/domain-forbidden', '/domain-operator');
  const operated = yield* calling(PAGE.navigate_page.body.execute({ page: retained.value.id, url: operatorTarget }, undefined, OPERATOR));
  expect(operated.page.url).toBe(operatorTarget);
  const ancestorCall = yield* denied(
    calling(
      PAGE.evaluate_in_page.body.execute(
        {
          page: retained.value.id,
          expression: `window.open(${JSON.stringify(forbidden)}, 'source'); true`,
        },
        undefined,
        caller,
      ),
    ),
    watch(retained.value.id),
    input.reached,
  );
  const ancestorFailure =
    ancestorCall._tag === 'Failure'
      ? ancestorCall.failure
      : yield* Effect.flip(calling(PAGE.evaluate_in_page.body.execute({ page: retained.value.id, expression: '0' }, undefined, caller)));
  expect(ancestorFailure).toMatchObject({ code: 'domain-blocked' });
  expect(visits.length).toBe(before);
  expect((yield* refusalOf(calling(PAGE.open_page.body.execute({ url: forbidden, profile }, undefined, caller)))).code).toBe(
    'domain-blocked',
  );
  const redirected = yield* refusalOf(navigate(url.replace('/domains', '/domain-redirect')));
  expect(redirected.code).toBe('domain-blocked');
  expect(visits.length).toBe(before);
  yield* navigate(url, OPERATOR);
  yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'load', timeoutMs: 120_000 }, undefined, caller));
  for (const label of ['Blocked frame', 'Blocked popup', 'Blocked link']) {
    const shot = yield* snapshot;
    const outcome = yield* denied(click(refIn(shot, new RegExp(`(?:button|link) "${label}"`))), watch(page), input.reached);
    const failure =
      outcome._tag === 'Failure'
        ? outcome.failure
        : yield* Effect.flip(calling(PAGE.evaluate_in_page.body.execute({ page, expression: '0' }, undefined, caller)));
    expect(failure).toMatchObject({ code: 'domain-blocked' });
    expect(visits.length).toBe(before);
  }
  yield* navigate(url, OPERATOR);
  yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'load', timeoutMs: 120_000 }, undefined, caller));
  yield* click(refIn(yield* snapshot, /button "Fetch resource"/));
  yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Resource fetched', timeoutMs: 5_000 }, undefined, caller));
  expect(visits.length).toBe(before + 1);
  yield* navigate(forbidden, OPERATOR);
  expect(visits.length).toBe(before + 2);
  yield* write(blockedDomains.id, [], 'project');
  yield* navigate(forbidden);
  expect(visits.length).toBe(before + 3);
  yield* write(allowedDomains.id, ['127.0.0.1'], 'project');
  const allowRefusal = yield* refusalOf(navigate(forbidden));
  expect(allowRefusal).toMatchObject({ code: 'domain-blocked' });
  expect(allowRefusal.reason).toContain(allowedDomains.id);
  expect(visits.length).toBe(before + 3);
  yield* write(blockedDomains.id, [], 'user');
  yield* write(allowedDomains.id, [], 'user');
  yield* write(allowedDomains.id, [], 'project');
  yield* navigate(url.replace('/domains', '/form'), OPERATOR);
});

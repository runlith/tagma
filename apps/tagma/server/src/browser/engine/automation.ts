import { parsed } from '@runlith/cdp/payload';
import { isCommandFailure } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Clock, Effect, Exit, FileSystem, Option, Path, PubSub, Scope, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { ServedRoots } from '../contract/service/sources.js';
import { Automation, type ConsoleQuery, type NetworkQuery, type Until } from '../contract/service/automation.js';
import { hostRefusal, Pages } from '../contract/service/pages.js';
import { BrowserPlace, capturesOf } from '../contract/service/place.js';
import { Profiles } from '../contract/service/profiles.js';
import { ThreadRuns } from '../contract/service/runs.js';
import type { PageId } from '../contract/wire/ids.js';
import type { ActionRun } from '../contract/wire/pageOperations.js';
import type { Picked } from '../contract/wire/pick.js';
import { BODY_CHARS, CONSOLE_LEVELS, type ConsoleEntry, EVALUATED_CHARS } from '../contract/wire/rows.js';
import { perform } from './act.js';
import type { Attached, Drive, Paged } from './drive.js';
import { picking } from './cursor.js';
import { operatorQuiet } from './operator.js';
import { navigationBlocked, unknownPage } from './refusal.js';
import { applyEmulation, changeConditions, effectiveOf, nextEmulation } from './emulate.js';
import { describePick, screenshot, snapshot } from './read.js';
import { world } from './target.js';
import { makeHeap } from './heap.js';
import type { Analysis } from './analysis.js';

const PROBE_MS = 100;
const CAPTURES_KEPT = 20;

const STRINGIFY = `function (limit) {
  let text;
  try { text = JSON.stringify(this); } catch (error) { text = String(this); }
  if (text === undefined) text = String(this);
  return text.length > limit ? [text.slice(0, limit), true] : [text, false];
}`;

const severity = (level: ConsoleEntry['level']): number => CONSOLE_LEVELS.indexOf(level);

const PROBE = `(function (until, value) {
  const visible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const seen = { url: location.href, title: document.title, state: document.readyState };
  if (until === 'load') return { met: document.readyState === 'complete', seen };
  if (until === 'url') return { met: location.href.includes(value), seen };
  if (until === 'text') return { met: (document.body ? document.body.innerText : '').includes(value), seen };
  let found = null;
  try { found = document.querySelector(value); } catch (error) { return { met: false, seen, invalid: String(error) }; }
  return { met: found !== null && visible(found), seen };
})`;

type Probe = {
  readonly met: boolean;
  readonly seen: { readonly url: string; readonly title: string; readonly state: string };
  readonly invalid?: string;
};

export const makeAutomation = Effect.fnUntraced(function* (input: { readonly drive: Drive; readonly analysis: Analysis }) {
  const { drive } = input;
  const pages = yield* Pages;
  const profiles = yield* Profiles;
  const runs = yield* ThreadRuns;
  const place = yield* BrowserPlace;
  const files = yield* FileSystem.FileSystem;
  const checkoutPaths = yield* CheckoutPaths;
  const servedRoots = yield* ServedRoots;
  const path = yield* Path.Path;
  const heap = yield* makeHeap(input);

  const navigatedSince = (attached: Attached, before: number): boolean => attached.navigations > before;

  const keep = Effect.fn('Automation.keep')(function* (page: PageId, bytes: Uint8Array, extension: string) {
    const dir = capturesOf(path, place, page);
    yield* files.makeDirectory(dir, { recursive: true });
    const file = path.join(dir, `${yield* Clock.currentTimeMillis}.${extension}`);
    yield* files.writeFile(file, bytes);
    const kept = (yield* files.readDirectory(dir)).filter((name) => /\.(png|pdf)$/u.test(name)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - CAPTURES_KEPT))) yield* files.remove(path.join(dir, old), { force: true });
    return file;
  });

  const painted = (page: PageId) =>
    Effect.flatMap(pages.hold(page), (host) =>
      host.pages.paint(page).pipe(
        Effect.catchTags({
          PageMissing: () => Effect.fail(unknownPage(page)),
          HostLost: (lost) => Effect.fail(hostRefusal(lost)),
          HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
        }),
      ),
    );

  const consoleOff = (page: PageId) =>
    new GateRefusal(
      'console-off',
      `the profile of page ${page} captures no console: reading it would need Runtime.enable, which sites read as automation`,
      ['update_profile with console: auto or always, then read again'],
    );

  const probe = (page: PageId, until: Until, thread: string | null) =>
    drive.drive(page, thread, (_state, attached) =>
      Effect.gen(function* () {
        const context = yield* world(attached, attached.main).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
        if (context === null) return { met: false, seen: { url: pages.urlOf(page), title: '', state: 'unknown' } } satisfies Probe;
        const reply = yield* attached.session.send('Runtime.evaluate', {
          expression: `${PROBE}(${JSON.stringify(until.kind)}, ${JSON.stringify('value' in until ? until.value : '')})`,
          contextId: context,
          returnByValue: true,
        });
        return reply.result.value as Probe;
      }),
    );

  return Automation.of({
    heap,
    navigate: Effect.fn('Automation.navigate')(function* (page, to, thread, agent = thread !== null) {
      return yield* drive.run(
        page,
        thread,
        thread !== null,
        (_state, attached) =>
          Effect.gen(function* () {
            const host = yield* pages.hold(page);
            const change = yield* host.pages.navigate(page, to).pipe(
              Effect.catchTags({
                NavigationBlocked: (blocked) => Effect.fail(navigationBlocked(blocked)),
                NavigationFailed: (failed) =>
                  Effect.fail(
                    new GateRefusal('navigation-failed', `the navigation failed: ${failed.code} — ${failed.message}`, [
                      'check the address and that its server answers',
                    ]),
                  ),
                PageMissing: () => Effect.fail(unknownPage(page)),
                HostLost: (lost) => Effect.fail(hostRefusal(lost)),
                HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
              }),
            );
            if (attached !== null) yield* drive.syncNavigation(attached);
            yield* pages.commit(page, change);
            return pages.glance(page, to.kind !== 'stop');
          }),
        { agent, recovers: to.kind === 'reload' || to.kind === 'stop' ? true : undefined },
      );
    }),
    snapshot: Effect.fn('Automation.snapshot')(function* (page, options, thread) {
      return yield* drive.drive(page, thread, (state, attached) =>
        Effect.map(snapshot(state, attached, options.within, options.limit), (shot) => ({ page: pages.glance(page, false), ...shot })),
      );
    }),
    act: Effect.fn('Automation.act')(function* (page, steps, thread, agent = thread !== null) {
      let completed = 0;
      let step = 1;
      let navigation: { readonly attached: Attached; readonly before: number } | null = null;
      const answer = (stopped: number | null): ActionRun => ({
        page: pages.glance(page, navigation !== null && navigatedSince(navigation.attached, navigation.before)),
        completed,
        stopped,
      });
      return yield* drive
        .drive(
          page,
          thread,
          (state, attached) =>
            Effect.gen(function* () {
              navigation = { attached, before: attached.navigations };
              for (const action of steps) {
                step = completed + 1;
                if (action instanceof GateRefusal) return yield* action;
                if (agent) yield* operatorQuiet(pages, page);
                yield* perform(state, attached, action);
                if (pages.live(page)?.dialog != null) return answer(step);
                completed += 1;
              }
              return answer(null);
            }),
          { opened: () => Effect.sync(() => answer(step)), replays: false, agent },
        )
        .pipe(
          Effect.mapError((failure) => {
            if (!(failure instanceof GateRefusal)) return failure;
            const left = pages.live(page) === undefined ? 'the page closed' : `the page stands at ${JSON.stringify(pages.urlOf(page))}`;
            return new GateRefusal(
              failure.code,
              `step ${step} stopped after ${completed} completed; ${left}: ${failure.reason}`,
              failure.unblock,
              failure.inputFile,
              failure.words,
            );
          }),
        );
    }),
    emulate: Effect.fn('Automation.emulate')(function* (page, change, thread) {
      return yield* drive.drive(page, thread, (state, attached) =>
        Effect.gen(function* () {
          if (thread !== null) yield* operatorQuiet(pages, page);
          const previous = state.emulation;
          const next = nextEmulation(previous, change);
          return yield* Effect.gen(function* () {
            yield* applyEmulation(attached.session, effectiveOf(next, state.layout), effectiveOf(previous, state.layout));
            if (next.cpu !== previous.cpu || next.network !== previous.network || next.geolocation !== previous.geolocation)
              yield* changeConditions(state, attached, next, thread).pipe(
                Effect.provideService(Pages, pages),
                Effect.provideService(ThreadRuns, runs),
              );
            else state.emulation = next;
            return { page: pages.glance(page, false), emulation: effectiveOf(next, state.layout) };
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? applyEmulation(attached.session, effectiveOf(previous, state.layout), effectiveOf(next, state.layout)).pipe(
                    Effect.catchIf(isCommandFailure, (failure) =>
                      Effect.logWarning(`browser: layout on ${page} could not be restored after refused emulation: ${failure.message}`),
                    ),
                    Effect.andThen(
                      Effect.sync(() => {
                        state.emulation = {
                          ...state.emulation,
                          viewport: previous.viewport,
                          device: previous.device,
                          scheme: previous.scheme,
                        };
                      }),
                    ),
                  )
                : Effect.void,
            ),
          );
        }),
      );
    }),
    capture: Effect.fn('Automation.capture')(function* (page, kind, ref, thread) {
      if (kind === 'pdf') {
        const host = yield* pages.hold(page);
        const bytes = yield* drive.run(page, thread, false, () =>
          host.pages.pdf(page).pipe(
            Effect.catchTags({
              PageMissing: () => Effect.fail(unknownPage(page)),
              HostLost: (lost) => Effect.fail(hostRefusal(lost)),
              HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
            }),
          ),
        );
        const file = yield* Effect.orDie(keep(page, bytes, 'pdf'));
        return { page: pages.glance(page, false), path: file, mediaType: 'application/pdf', bytes, width: null, height: null };
      }
      if (kind === 'element' && ref === undefined) {
        return yield* new GateRefusal('action-shape', 'an element capture names the `ref` of the element', ['send `ref` from a snapshot']);
      }
      const shot = yield* drive.drive(page, thread, (state, attached) =>
        Effect.scoped(Effect.andThen(painted(page), screenshot(state, attached, kind, ref))),
      );
      const file = yield* Effect.orDie(keep(page, shot.bytes, 'png'));
      return {
        page: pages.glance(page, false),
        path: file,
        mediaType: 'image/png',
        bytes: shot.bytes,
        width: shot.width,
        height: shot.height,
      };
    }),
    picture: (file) => Effect.orDie(files.readFile(file)),
    evaluate: Effect.fn('Automation.evaluate')(function* (page, expression, thread, agent = thread !== null) {
      return yield* drive.drive(
        page,
        thread,
        (_state, attached) =>
          Effect.gen(function* () {
            const text = yield* attached.session.reply('Runtime.evaluate', {
              expression,
              awaitPromise: true,
              userGesture: true,
              returnByValue: false,
            });
            const reply = (yield* parsed(text, EVALUATED_CHARS + 1)) as { readonly result: Protocol.Runtime.EvaluateResponse };
            const { result, exceptionDetails } = reply.result;
            if (exceptionDetails !== undefined) {
              return { page: pages.glance(page, false), exception: exceptionDetails.exception?.description ?? exceptionDetails.text };
            }
            if (result.objectId === undefined) {
              const value =
                result.type === 'undefined'
                  ? 'undefined'
                  : result.unserializableValue !== undefined
                    ? result.unserializableValue
                    : JSON.stringify(result.value);
              return { page: pages.glance(page, false), value: value.slice(0, EVALUATED_CHARS), cut: value.length > EVALUATED_CHARS };
            }
            const told = yield* attached.session.send('Runtime.callFunctionOn', {
              objectId: result.objectId,
              functionDeclaration: STRINGIFY,
              arguments: [{ value: EVALUATED_CHARS }],
              returnByValue: true,
            });
            yield* attached.session.send('Runtime.releaseObject', { objectId: result.objectId });
            const [value, cut] = told.result.value as [string, boolean];
            return { page: pages.glance(page, false), value, cut };
          }),
        { opened: (opened) => Effect.succeed({ page: pages.glance(opened, false), value: 'undefined', cut: false }), agent },
      );
    }),
    wait: Effect.fn('Automation.wait')(function* (page, until, timeoutMs, thread) {
      const started = yield* Clock.currentTimeMillis;
      let seen: Probe['seen'] | null = null;
      const loop = Effect.gen(function* () {
        for (;;) {
          const probed = yield* probe(page, until, thread);
          if (probed.invalid !== undefined) {
            return yield* new GateRefusal(
              'wait-unmet',
              `${JSON.stringify('value' in until ? until.value : '')} is not a CSS selector: ${probed.invalid}`,
              ['name a valid CSS selector'],
            );
          }
          seen = probed.seen;
          const live = pages.live(page);
          if (probed.met && (until.kind !== 'load' || live?.loading !== true)) return;
          yield* Effect.sleep(PROBE_MS);
        }
      });
      const met = yield* loop.pipe(Effect.timeoutOption(timeoutMs));
      if (Option.isNone(met)) {
        const last = seen as Probe['seen'] | null;
        return yield* new GateRefusal(
          'wait-unmet',
          `${until.kind}${'value' in until ? ` ${JSON.stringify(until.value)}` : ''} was not met within ${timeoutMs} ms${
            last === null ? '' : `; the page stood at ${last.url} titled ${JSON.stringify(last.title)}, ${last.state}`
          }`,
          ['snapshot_page — see what the page shows', 'wait again with a longer timeoutMs'],
        );
      }
      return { page: pages.glance(page, false), waitedMs: (yield* Clock.currentTimeMillis) - started };
    }),
    console: Effect.fn('Automation.console')(function* (page, query: ConsoleQuery, thread) {
      const profile = pages.profileOf(page);
      if (profile === undefined) return yield* unknownPage(page);
      const record = yield* profiles.record(profile).pipe(Effect.catchTag('GateRefusal', () => Effect.fail(unknownPage(page))));
      if (record.console === 'never') return yield* consoleOff(page);
      return yield* drive.drive(page, thread, (state: Paged, attached) =>
        Effect.gen(function* () {
          state.asked = true;
          yield* drive.syncRuntime(state, attached);
          yield* attached.syncEvents();
          const floor = query.level === undefined ? CONSOLE_LEVELS.length - 1 : severity(query.level);
          const match = query.match;
          const named = query.seq === undefined ? undefined : state.console.at(query.seq);
          const read =
            query.seq === undefined
              ? state.console.read({
                  limit: query.limit,
                  after: query.after,
                  keep: (entry) =>
                    severity(entry.level) <= floor &&
                    (match === undefined || entry.text.includes(match) || (entry.url ?? '').includes(match)),
                })
              : {
                  entries: named === undefined ? [] : [{ seq: query.seq, entry: named }],
                  total: named === undefined ? 0 : 1,
                  dropped: state.console.dropped,
                };
          return {
            entries: read.entries.map(({ seq, entry: { stack, ...entry } }) =>
              query.stack ? { ...entry, seq, stack: stack ?? null } : { ...entry, seq },
            ),
            total: read.total,
            dropped: read.dropped,
            capturing: attached.runtime !== null,
          };
        }),
      );
    }),
    network: Effect.fn('Automation.network')(function* (page, query: NetworkQuery) {
      if (pages.live(page) === undefined) return yield* unknownPage(page);
      const state = yield* drive.paged(page);
      const match = query.match;
      const read = state.network.read({
        limit: query.limit,
        after: query.after,
        keep: (entry) =>
          (match === undefined || entry.url.includes(match)) &&
          (!query.failed || entry.failure !== null || (entry.status !== null && entry.status >= 400)),
      });
      return { entries: read.entries.map(({ seq, entry }) => ({ ...entry, seq })), total: read.total, dropped: read.dropped };
    }),
    body: Effect.fn('Automation.body')(function* (page, request, thread) {
      const unavailable = (why: string) =>
        new GateRefusal('body-unavailable', `the page no longer holds the body of request ${request}: ${why}`, [
          'load the page again and read the body before it navigates away',
        ]);
      return yield* drive.drive(page, thread, (state, attached) =>
        Effect.gen(function* () {
          const known = state.requests.get(request);
          const target = known?.target;
          const child = target === undefined ? undefined : [...attached.children].find(([, root]) => root === target)?.[0];
          if (known === undefined ? request.includes(':') : target !== undefined && child === undefined)
            return yield* unavailable('its frame is gone');
          const text = yield* attached.session
            .reply('Network.getResponseBody', { requestId: known?.id ?? request }, child)
            .pipe(Effect.catchTag('CommandRefused', (refused) => Effect.fail(unavailable(refused.message))));
          const reply = (yield* parsed(text, BODY_CHARS + 1)) as { readonly result: Protocol.Network.GetResponseBodyResponse };
          const { body, base64Encoded } = reply.result;
          return { body: body.slice(0, BODY_CHARS), base64: base64Encoded, cut: body.length > BODY_CHARS };
        }),
      );
    }),
    answer: Effect.fn('Automation.answer')(function* (page, accept, text, thread) {
      const live = pages.live(page);
      if (live === undefined) return yield* unknownPage(page);
      if (live.dialog === null)
        return yield* new GateRefusal('no-dialog', `no dialog is open on page ${page}`, ['act on the page as it stands']);
      const host = yield* pages.hold(page);
      if (thread !== null) (yield* drive.paged(page)).driver = thread;
      yield* host.pages.answer(page, accept, text).pipe(
        Effect.catchTags({
          PageMissing: () => Effect.fail(unknownPage(page)),
          HostLost: (lost) => Effect.fail(hostRefusal(lost)),
          HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
        }),
      );
      yield* pages.mark(page, { dialog: null });
      return pages.glance(page, false);
    }),
    pick: Effect.fn('Automation.pick')(function* (page, projectId) {
      const attached = yield* drive.drive(page, null, (_state, held) => Effect.succeed(held));
      const subscription = yield* PubSub.subscribe(attached.picks);
      const scope = yield* Effect.scope;
      yield* drive.drive(page, null, (state, now) =>
        Effect.gen(function* () {
          yield* Scope.provide(painted(page), scope);
          yield* Scope.provide(picking(state, now), scope);
        }),
      );
      return Stream.fromSubscription(subscription).pipe(
        Stream.interruptWhen(attached.session.ended),
        Stream.mapEffect((picking) =>
          drive
            .drive(page, null, (held, now) =>
              describePick(held, now, page, pages.urlOf(page), picking, projectId).pipe(
                Effect.provideService(FileSystem.FileSystem, files),
                Effect.provideService(CheckoutPaths, checkoutPaths),
                Effect.provideService(ServedRoots, servedRoots),
                Effect.provideService(Path.Path, path),
              ),
            )
            .pipe(
              Effect.catchIf(
                (failure) => failure._tag === 'GateRefusal' && (failure.code === 'stale-ref' || failure.code === 'action-failed'),
                (failure) =>
                  Effect.as(
                    Effect.logInfo(
                      `browser: a pick on page ${page} was not described: ${failure._tag === 'GateRefusal' ? failure.reason : ''}`,
                    ),
                    null,
                  ),
              ),
            ),
        ),
        Stream.filter((picked): picked is Picked => picked !== null),
      );
    }),
  });
});

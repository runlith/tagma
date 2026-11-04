import { bytesOf } from '@runlith/cdp/payload';
import { pipeTransport } from '@runlith/cdp/pipe';
import { heapToFile } from '@runlith/cdp/stream';
import {
  type CdpEvent,
  type CommandFailure,
  type Connection,
  connect,
  eventParams,
  isCommandFailure,
  type Session,
} from '@runlith/cdp/session';
import { Clock, Deferred, Effect, Exit, Fiber, FileSystem, Option, Path, PubSub, Schema, Scope, Stream } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import {
  type Host,
  type HostFailure,
  HostLost,
  HostRefused,
  NavigationFailed,
  PageMissing,
  PageStayed,
  type ProfileRecord,
} from '../browser/contract/service/hosts.js';
import { type HostEvent, type LivePage, type Navigation, type PageChange } from '../browser/contract/wire/host.js';
import type { PageId, ProfileId } from '../browser/contract/wire/ids.js';
import { type Downloads, makeDownloads } from './downloads.js';
import { ManagedPlace } from './contract/service/place.js';
import { LaunchPlatform } from './contract/service/launch.js';
import { type BuildId, MANAGED, ManagedDocument } from './contract/wire/document.js';
import type { Build } from './builds/build.js';
import { makeChromeForTesting } from './builds/chromeForTesting.js';
import { makeInstalledChrome } from './builds/installedChrome.js';
import { committed } from './commit.js';
import { captureHost, hiddenTarget, lost, quiet } from './targets.js';
import { makePermissions, type Permissions } from './permissions.js';
import { makeNavigation, type NavigationGate } from './navigation.js';
import { makeWindows, type Windows } from './windows.js';

const IDLE_MS = 5 * 60_000;
const UNLOAD_MS = 15 * 60_000;
const SWEEP = '30 seconds';
const STOP_AFTER = '3 seconds';

const ICON = `(() => { const link = document.querySelector('link[rel~="icon"]'); return link ? link.href : new URL('/favicon.ico', location.href).href; })()`;

type Tab = {
  readonly target: string;
  page: PageId | null;
  service: Session | null;
  scope: Scope.Closeable | null;
  dialog: Deferred.Deferred<void> | null;
  crashed: boolean;
  url: string;
  title: string;
  readonly opener: PageId | null;
  sessions: number;
  quietSince: number | null;
};

const tabOn = (target: string, opener: PageId | null, url = '', title = ''): Tab => ({
  target,
  page: null,
  service: null,
  scope: null,
  dialog: null,
  crashed: false,
  url,
  title,
  opener,
  sessions: 0,
  quietSince: null,
});

type Running = {
  readonly profile: ProfileId;
  readonly connection: Connection;
  readonly scope: Scope.Closeable;
  readonly tabs: Map<string, Tab>;
  readonly downloads: Downloads;
  readonly permissions: Permissions;
  readonly navigation: NavigationGate;
  readonly dir: string;
  readonly windows: Windows;
  users: number;
  idleSince: number | null;
};

export const makeManagedHost = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const place = yield* ManagedPlace;
  const platform = yield* LaunchPlatform;
  const spawner = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
  const builds: Readonly<Record<BuildId, Build>> = {
    'chrome-for-testing': yield* makeChromeForTesting,
    'installed-chrome': yield* makeInstalledChrome,
  };
  const scope = yield* Effect.scope;
  const events = yield* PubSub.unbounded<HostEvent>();
  const running = new Map<ProfileId, Running>();
  const starting = new Map<ProfileId, Deferred.Deferred<Running, HostFailure>>();
  const located = new Map<PageId, { readonly state: Running; readonly target: string }>();
  const closings = new Map<PageId, Deferred.Deferred<boolean, HostFailure>>();
  let revision = 0;
  const nextRevision = () => ++revision;

  const emit = (event: HostEvent) => Effect.asVoid(PubSub.publish(events, event));

  const refused = (message: string) => new HostRefused({ message, unblock: ['open the page again'] });

  const tabOf = (page: PageId): Effect.Effect<{ readonly state: Running; readonly tab: Tab }, PageMissing> => {
    const at = located.get(page);
    const tab = at?.state.tabs.get(at.target);
    return at === undefined || tab === undefined || tab.page !== page
      ? Effect.fail(new PageMissing({ page, message: `the managed browser holds no page ${page}` }))
      : Effect.succeed({ state: at.state, tab });
  };

  const serviceOf = (page: PageId) =>
    Effect.flatMap(tabOf(page), ({ state, tab }) =>
      tab.service === null
        ? Effect.fail(new PageMissing({ page, message: `page ${page} is still opening` }))
        : Effect.succeed({ state, tab, service: tab.service }),
    );

  const historyOf = Effect.fnUntraced(function* (service: Session): Effect.fn.Return<PageChange, CommandFailure> {
    const read = yield* service
      .send('Page.getNavigationHistory')
      .pipe(
        Effect.catchTag('CommandRefused', (refusal) =>
          Effect.as(Effect.logDebug(`managed browser: the history is not readable mid-navigation: ${refusal.message}`), null),
        ),
      );
    if (read === null) return {};
    const { currentIndex, entries } = read;
    const current = entries[currentIndex];
    return {
      url: current?.url,
      title: current?.title,
      back: currentIndex > 0,
      forward: currentIndex < entries.length - 1,
      history: { entries: entries.map((entry) => ({ url: entry.url, title: entry.title })), at: currentIndex },
    };
  });

  const changed = (tab: Tab, change: PageChange) => {
    if (change.url !== undefined) tab.url = change.url;
    if (change.title !== undefined) tab.title = change.title;
    return tab.page === null ? Effect.void : emit({ kind: 'changed', page: tab.page, change });
  };

  const faviconOf = Effect.fnUntraced(function* (tab: Tab, service: Session) {
    const { executionContextId } = yield* service.send('Page.createIsolatedWorld', { frameId: tab.target, worldName: 'host' });
    const { result } = yield* service.send('Runtime.evaluate', { expression: ICON, contextId: executionContextId, returnByValue: true });
    yield* changed(tab, { favicon: typeof result.value === 'string' && /^https?:/u.test(result.value) ? result.value : null });
  });

  const onPage = Effect.fnUntraced(function* (state: Running, tab: Tab, service: Session, event: CdpEvent) {
    if (event.child !== undefined || tab.page === null) return;
    const page = tab.page;
    switch (event.method) {
      case 'Page.frameResized':
        return yield* state.windows.remember(tab.target);
      case 'Page.frameNavigated': {
        const { frame } = yield* eventParams('Page.frameNavigated', event);
        if (frame.parentId === undefined)
          yield* changed(tab, { ...(yield* historyOf(service)), url: `${frame.url}${frame.urlFragment ?? ''}` });
        return;
      }
      case 'Page.navigatedWithinDocument': {
        const { frameId, url } = yield* eventParams('Page.navigatedWithinDocument', event);
        if (frameId === tab.target) yield* changed(tab, { ...(yield* historyOf(service)), url });
        return;
      }
      case 'Page.frameStartedLoading': {
        const { frameId } = yield* eventParams('Page.frameStartedLoading', event);
        if (frameId === tab.target) yield* changed(tab, { loading: true });
        return;
      }
      case 'Page.frameStoppedLoading': {
        const { frameId } = yield* eventParams('Page.frameStoppedLoading', event);
        if (frameId !== tab.target) return;
        yield* changed(tab, { ...(yield* historyOf(service)), loading: false });
        if (tab.scope !== null) yield* Effect.forkIn(faviconOf(tab, service).pipe(quiet(`reading the icon of page ${page}`)), tab.scope);
        return;
      }
      case 'Page.javascriptDialogOpening': {
        const opened = yield* eventParams('Page.javascriptDialogOpening', event);
        tab.dialog ??= yield* Deferred.make<void>();
        yield* emit({
          kind: 'dialog',
          page,
          dialog: {
            kind: opened.type,
            message: opened.message,
            prompt: opened.type === 'prompt' ? (opened.defaultPrompt ?? '') : null,
            url: opened.url,
          },
        });
        return;
      }
      case 'Page.javascriptDialogClosed': {
        const closed = tab.dialog;
        tab.dialog = null;
        yield* emit({ kind: 'dialog', page, dialog: null });
        if (closed !== null) yield* Deferred.succeed(closed, undefined);
        return;
      }
    }
  });

  const bind = Effect.fnUntraced(function* (state: Running, target: string, page: PageId): Effect.fn.Return<Session, CommandFailure> {
    const tab = state.tabs.get(target) ?? tabOn(target, null);
    state.tabs.set(target, tab);
    tab.page = page;
    tab.quietSince = yield* Clock.currentTimeMillis;
    located.set(page, { state, target });
    state.idleSince = null;
    const held = yield* Scope.fork(state.scope);
    tab.scope = held;
    const { sessionId } = yield* state.connection.root.send('Target.attachToTarget', { targetId: target, flatten: true });
    const service = yield* Scope.provide(state.connection.attach(sessionId), held);
    const stream = yield* Scope.provide(service.events(), held);
    yield* Stream.runForEach(stream, (event) => onPage(state, tab, service, event).pipe(quiet(`an event of page ${page}`))).pipe(
      Effect.forkIn(held),
    );
    yield* Scope.provide(state.navigation.bind(target, page, service), held);
    yield* service.send('Page.enable');
    const { frameTree } = yield* service.send('Page.getFrameTree');
    yield* state.navigation.tree(target, frameTree);
    tab.service = service;
    yield* changed(tab, yield* historyOf(service));
    return service;
  });

  const unbind = Effect.fnUntraced(function* (state: Running, tab: Tab) {
    state.tabs.delete(tab.target);
    if (tab.page !== null && located.get(tab.page)?.target === tab.target) located.delete(tab.page);
    const held = tab.scope;
    tab.scope = null;
    tab.service = null;
    if (held !== null) yield* Scope.close(held, Exit.void);
    yield* state.navigation.forget(tab.target).pipe(quiet(`releasing the navigation gate of target ${tab.target}`));
  });

  const abandon = Effect.fnUntraced(function* (state: Running, target: string) {
    const tab = state.tabs.get(target);
    if (tab !== undefined) yield* unbind(state, tab);
    yield* state.connection.root.send('Target.closeTarget', { targetId: target }).pipe(quiet(`closing target ${target}`));
  });

  const onBrowser = Effect.fnUntraced(function* (state: Running, event: CdpEvent) {
    switch (event.method) {
      case 'Target.targetCreated': {
        const { targetInfo: info } = yield* eventParams('Target.targetCreated', event);
        yield* state.navigation.created(info);
        if (info.type !== 'page' || info.openerId === undefined || state.tabs.has(info.targetId)) return;
        const opener = state.tabs.get(info.openerId)?.page ?? null;
        if (opener === null) return;
        state.tabs.set(info.targetId, tabOn(info.targetId, opener, info.url, info.title));
        yield* emit({
          kind: 'opened',
          local: info.targetId,
          profile: state.profile,
          opener,
          url: info.url,
          restriction: state.navigation.state(info.targetId),
          disposition: 'tab',
        });
        return;
      }
      case 'Target.targetInfoChanged': {
        const { targetInfo: info } = yield* eventParams('Target.targetInfoChanged', event);
        const tab = state.tabs.get(info.targetId);
        if (tab !== undefined) yield* changed(tab, { title: info.title });
        return;
      }
      case 'Target.targetDestroyed': {
        const { targetId } = yield* eventParams('Target.targetDestroyed', event);
        const tab = state.tabs.get(targetId);
        if (tab === undefined) {
          yield* state.navigation.forget(targetId);
          return;
        }
        const page = tab.page;
        yield* unbind(state, tab);
        if (page !== null) yield* emit({ kind: 'closed', page });
        return;
      }
      case 'Target.targetCrashed': {
        const { targetId } = yield* eventParams('Target.targetCrashed', event);
        const tab = state.tabs.get(targetId);
        if (tab !== undefined) tab.crashed = true;
        const page = tab?.page ?? null;
        if (page !== null) yield* emit({ kind: 'crashed', page });
        return;
      }
      case 'Fetch.requestPaused':
        yield* state.navigation.request(yield* eventParams('Fetch.requestPaused', event));
        return;
      case 'Browser.downloadWillBegin':
      case 'Browser.downloadProgress':
        return yield* state.downloads.take(event);
    }
  });

  const drop = Effect.fnUntraced(function* (state: Running) {
    if (running.get(state.profile) === state) running.delete(state.profile);
    for (const tab of [...state.tabs.values()]) {
      const page = tab.page;
      yield* unbind(state, tab);
      if (page !== null) yield* emit({ kind: 'dropped', page });
    }
  });

  const gone = Effect.fnUntraced(function* (state: Running) {
    yield* drop(state);
    yield* state.connection.root.send('Browser.close').pipe(quiet(`closing the browser of profile ${state.profile}`));
    yield* Scope.close(state.scope, Exit.void);
  });

  const launch = Effect.fnUntraced(function* (profile: ProfileRecord): Effect.fn.Return<Running, HostFailure> {
    const document = yield* Schema.decodeUnknownEffect(ManagedDocument)(profile.document).pipe(
      Effect.mapError(() => refused(`profile ${profile.id} carries no document the managed browser reads`)),
    );
    const preparation = yield* Effect.promise(() => platform.prepare(document.window === 'shown'));
    if (preparation._tag === 'LaunchRefused') return yield* new HostRefused({ message: preparation.message, unblock: preparation.unblock });
    const build = yield* builds[document.build].launch.pipe(
      Effect.mapError((unavailable) => new HostRefused({ message: unavailable.message, unblock: unavailable.unblock })),
    );
    const dir = path.join(place.profiles, profile.id);
    const downloads = path.join(place.downloads, profile.id);
    yield* Effect.all([
      files.makeDirectory(dir, { recursive: true, mode: 0o700 }),
      files.makeDirectory(downloads, { recursive: true }),
    ]).pipe(Effect.mapError((failure) => refused(`the profile directory could not be made: ${failure.message}`)));
    const held = yield* Scope.fork(scope);
    let readDiagnostic: Effect.Effect<string> = Effect.succeed('');
    const opened = yield* Effect.gen(function* () {
      const handle = yield* Scope.provide(
        ChildProcess.make(build.executable, [...build.args(dir, document.window)], {
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'pipe',
          env: preparation.environment,
          forceKillAfter: STOP_AFTER,
          additionalFds: { fd3: { type: 'input' }, fd4: { type: 'output' } },
        }),
        held,
      ).pipe(
        Effect.provide(spawner),
        Effect.mapError((failure) => refused(`the browser did not start: ${failure.message}`)),
      );
      let diagnostic = '';
      const stderr = yield* handle.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            diagnostic = `${diagnostic}${chunk}`.slice(-8_000);
          }),
        ),
        Effect.forkIn(scope),
      );
      readDiagnostic = Fiber.join(stderr).pipe(
        Effect.map(() => diagnostic),
        Effect.orDie,
      );
      const transport = yield* Scope.provide(pipeTransport({ writer: handle.getInputFd(3), reader: handle.getOutputFd(4) }), held);
      const connection = yield* Scope.provide(connect(transport), held);
      const permissions = yield* makePermissions({ browser: connection.root });
      const navigation = yield* Scope.provide(makeNavigation({ connection, events, nextRevision }), held);
      yield* connection.root.send('Target.setDiscoverTargets', { discover: true }).pipe(Effect.mapError(lost));
      const { targetInfos } = yield* connection.root.send('Target.getTargets').pipe(Effect.mapError(lost));
      const own = yield* connection.root.send('Target.createTarget', { url: 'about:blank', background: true }).pipe(Effect.mapError(lost));
      const windows = yield* makeWindows({ browser: connection.root, own: own.targetId, mode: document.window }).pipe(
        Effect.mapError(lost),
      );
      const state: Running = {
        profile: profile.id,
        connection,
        scope: held,
        tabs: new Map(),
        downloads: makeDownloads({ directory: downloads, navigation, events }),
        permissions,
        navigation,
        dir,
        windows,
        users: 0,
        idleSince: null,
      };
      const stream = yield* Scope.provide(connection.root.events(), held);
      yield* Stream.runForEach(stream, (event) => onBrowser(state, event).pipe(quiet('a browser event'))).pipe(Effect.forkIn(held));
      yield* state.downloads.start(connection.root).pipe(Effect.mapError(lost));

      for (const info of targetInfos) {
        if (info.type === 'page')
          yield* connection.root.send('Target.closeTarget', { targetId: info.targetId }).pipe(Effect.mapError(lost));
      }
      yield* Scope.provide(
        Effect.addFinalizer(() =>
          Effect.andThen(
            drop(state),
            connection.root
              .send('Browser.close')
              .pipe(Effect.andThen(Effect.orDie(handle.exitCode)), Effect.asVoid, quiet(`closing the browser of profile ${state.profile}`)),
          ),
        ),
        held,
      );
      yield* Effect.flatMap(connection.ended, () => gone(state)).pipe(Effect.forkIn(scope));
      return state;
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(held, Exit.void) : Effect.void)),
      Effect.catchTag('HostLost', (failure) =>
        Effect.flatMap(readDiagnostic, (diagnostic) => {
          const refusal = platform.failed(`${failure.message}\n${diagnostic}`.trim());
          return Effect.fail(new HostRefused({ message: refusal.message, unblock: refusal.unblock }));
        }),
      ),
    );
    running.set(profile.id, opened);
    return opened;
  });

  const ensure = Effect.fnUntraced(function* (profile: ProfileRecord): Effect.fn.Return<Running, HostFailure> {
    const standing = running.get(profile.id);
    if (standing !== undefined) return standing;
    const waiting = starting.get(profile.id);
    if (waiting !== undefined) return yield* Deferred.await(waiting);
    const done = yield* Deferred.make<Running, HostFailure>();
    starting.set(profile.id, done);
    yield* launch(profile).pipe(
      Effect.onExit((exit) =>
        Effect.andThen(
          Effect.sync(() => {
            starting.delete(profile.id);
          }),
          Deferred.done(done, exit),
        ),
      ),
      Effect.forkIn(scope),
    );
    return yield* Deferred.await(done);
  });

  const unload = Effect.fnUntraced(function* (state: Running, tab: Tab, page: PageId) {
    yield* unbind(state, tab);
    yield* state.connection.root.send('Target.closeTarget', { targetId: tab.target }).pipe(quiet(`unloading page ${page}`));
    yield* emit({ kind: 'dropped', page });
  });

  const sweep = Effect.fnUntraced(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const state of [...running.values()]) {
      for (const tab of [...state.tabs.values()]) {
        if (tab.page !== null && tab.sessions === 0 && tab.quietSince !== null && now - tab.quietSince >= UNLOAD_MS)
          yield* unload(state, tab, tab.page);
      }
      const busy = state.users > 0 || [...state.tabs.values()].some((tab) => tab.page !== null);
      if (busy) state.idleSince = null;
      else if (state.idleSince === null) state.idleSince = now;
      else if (now - state.idleSince >= IDLE_MS) yield* gone(state);
    }
  });

  yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(SWEEP), sweep())));

  const replace = Effect.fnUntraced(function* (state: Running, tab: Tab, page: PageId): Effect.fn.Return<PageChange, CommandFailure> {
    const url = tab.url || 'about:blank';
    const { targetId } = yield* state.connection.root.send('Target.createTarget', state.windows.page);
    yield* state.navigation.swap(tab.target, targetId);
    yield* unbind(state, tab);
    yield* state.connection.root.send('Target.closeTarget', { targetId: tab.target });
    const service = yield* bind(state, targetId, page);
    yield* emit({ kind: 'swapped', page });
    yield* emit({ kind: 'responsive', page });
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* service.events();
        const went = yield* service.send('Page.navigate', { url });
        if (went.errorText !== undefined && went.errorText !== '') return yield* historyOf(service);
        const committedUrl = yield* committed(targetId, stream, went.loaderId);
        const change = yield* historyOf(service);
        return { ...change, url: committedUrl ?? change.url };
      }),
    );
  });

  const navigate = Effect.fn('ManagedHost.navigate')(function* (page: PageId, to: Navigation) {
    const { state, tab, service } = yield* serviceOf(page);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* service.events();
        let loader: string | undefined | null = null;
        switch (to.kind) {
          case 'url': {
            yield* state.navigation.check(tab.target, to.url);
            const went = yield* service.send('Page.navigate', { url: to.url });
            if (went.errorText !== undefined && went.errorText !== '') {
              return yield* new NavigationFailed({ code: went.errorText, message: `${to.url} did not load` });
            }
            if (went.isDownload === true) return { ...(yield* historyOf(service)), loading: false };
            loader = went.loaderId;
            break;
          }
          case 'back':
          case 'forward': {
            const { currentIndex, entries } = yield* service.send('Page.getNavigationHistory');
            const entry = entries[currentIndex + (to.kind === 'back' ? -1 : 1)];
            if (entry === undefined) return yield* historyOf(service);
            yield* state.navigation.check(tab.target, entry.url);
            yield* service.send('Page.navigateToHistoryEntry', { entryId: entry.id });
            break;
          }
          case 'reload':
            yield* state.navigation.check(tab.target, tab.url);
            if (tab.crashed) return yield* replace(state, tab, page);
            yield* service.send('Page.reload');
            break;
          case 'stop':
            yield* service.send('Page.stopLoading');
            return { ...(yield* historyOf(service)), loading: false };
        }
        const url = yield* committed(tab.target, stream, loader);
        yield* state.permissions.synchronize(service);
        const change = yield* historyOf(service);
        return { ...change, url: url ?? change.url };
      }),
    ).pipe(Effect.catchIf(isCommandFailure, (failure) => Effect.fail(lost(failure))));
  });

  const host: Host = {
    id: MANAGED,
    adapter: MANAGED,
    pid: null,
    native: false,
    pages: {
      open: Effect.fn('ManagedHost.open')(function* (opening) {
        const state = yield* ensure(opening.profile);
        const url = opening.history?.entries[opening.history.at]?.url ?? opening.url;
        const { targetId } = yield* state.connection.root.send('Target.createTarget', state.windows.page).pipe(Effect.mapError(lost));
        yield* Effect.gen(function* () {
          const service = yield* bind(state, targetId, opening.page);
          yield* state.navigation.open(targetId, opening.policy);
          if (url === 'about:blank') return;
          yield* state.navigation.check(targetId, url);
          const went = yield* service.send('Page.navigate', { url });
          if (went.errorText !== undefined && went.errorText !== '')
            yield* Effect.logInfo(`managed browser: page ${opening.page} opened on ${url} with ${went.errorText}`);
        }).pipe(
          Effect.onError(() => abandon(state, targetId)),
          Effect.catchIf(isCommandFailure, (failure) => Effect.fail(lost(failure))),
        );
        return state.navigation.state(targetId);
      }),
      adopt: Effect.fn('ManagedHost.adopt')(function* (local, page) {
        const state = [...running.values()].find((held) => held.tabs.has(local));
        if (state === undefined) return yield* new PageMissing({ page, message: `the popup ${local} closed before it was adopted` });
        yield* bind(state, local, page).pipe(
          Effect.onError(() => abandon(state, local)),
          Effect.mapError(lost),
        );
        return state.navigation.state(local);
      }),
      close: Effect.fn('ManagedHost.close')(function* (page, ask) {
        const stayedFailure = new PageStayed({ page, message: 'the page asked to stay, and leaving it was dismissed' });
        const going = closings.get(page);
        if (ask && going !== undefined) {
          if (yield* Deferred.await(going)) return yield* stayedFailure;
          return;
        }
        const at = located.get(page);
        if (at === undefined) return;
        const tab = at.state.tabs.get(at.target);
        const service = tab?.service ?? null;
        if (ask && tab !== undefined && tab.dialog !== null) {
          return yield* new HostRefused({
            message: `a dialog is open on page ${page}, and closing it would bypass the answer`,
            unblock: ['answer_page_dialog — accept or dismiss it first, then close_page'],
          });
        }
        if (ask && tab !== undefined && service !== null) {
          const asked = yield* Deferred.make<boolean, HostFailure>();
          closings.set(page, asked);
          const stayed = yield* Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* service.events();
              const dismissed = stream.pipe(
                Stream.filter((event) => event.child === undefined && event.method === 'Page.javascriptDialogClosed'),
                Stream.mapEffect((event) => eventParams('Page.javascriptDialogClosed', event)),
                Stream.filter((closed) => !closed.result),
                Stream.runHead,
                Effect.map(Option.isSome),
              );
              yield* service.send('Page.close');
              return yield* Effect.raceFirst(dismissed, Effect.as(service.ended, false));
            }),
          ).pipe(
            Effect.catchTag('SessionEnded', () => Effect.succeed(false)),
            Effect.mapError(lost),
            Effect.onExit((exit) =>
              Effect.andThen(
                Deferred.done(asked, exit),
                Effect.sync(() => closings.delete(page)),
              ),
            ),
          );
          if (stayed) return yield* stayedFailure;
          return;
        }
        if (tab !== undefined) yield* unbind(at.state, tab);
        yield* at.state.connection.root.send('Target.closeTarget', { targetId: at.target }).pipe(
          Effect.catchTag('CommandRefused', (refusal) =>
            Effect.logDebug(`managed browser: page ${page} was already closed: ${refusal.message}`),
          ),
          Effect.mapError(lost),
        );
      }),
      live: Effect.sync(() =>
        [...running.values()].flatMap((state) =>
          [...state.tabs.values()].map((tab): LivePage => ({
            page: tab.page,
            local: tab.target,
            profile: state.profile,
            url: tab.url,
            title: tab.title,
            opener: tab.opener,
            restriction: state.navigation.state(tab.target),
          })),
        ),
      ),
      navigate,
      navigation: Effect.fnUntraced(function* (page, policy) {
        const { state, tab } = yield* tabOf(page);
        return yield* state.navigation.watch(tab.target, policy).pipe(Effect.mapError(lost));
      }),
      pdf: Effect.fn('ManagedHost.pdf')(function* (page) {
        const { service } = yield* serviceOf(page);
        const text = yield* service.reply('Page.printToPDF', { printBackground: true }).pipe(Effect.mapError(lost));
        return yield* bytesOf(text).pipe(Effect.mapError((failure) => new HostLost({ message: failure.message, pending: false })));
      }),
      heap: Effect.fn('ManagedHost.heap')(
        function* (page, path) {
          const { service } = yield* serviceOf(page);
          yield* heapToFile(service, path).pipe(
            Effect.provideService(FileSystem.FileSystem, files),
            Effect.mapError(
              (failure) =>
                new HostRefused({
                  message: `the page heap was not captured: ${failure.message}`,
                  unblock: ['capture_page with what: heap again'],
                }),
            ),
          );
        },
        Effect.uninterruptible,
        Effect.scoped,
      ),
      answer: Effect.fn('ManagedHost.answer')(function* (page, accept, text) {
        const { tab, service } = yield* serviceOf(page);
        const open = tab.dialog;
        yield* service.send('Page.handleJavaScriptDialog', { accept, promptText: text }).pipe(Effect.mapError(lost));
        if (open !== null) yield* Effect.raceFirst(Deferred.await(open), Effect.asVoid(service.ended));
      }),
      events: Effect.map(PubSub.subscribe(events), (subscription) => Stream.fromSubscription(subscription)),
      paint: (page) => Effect.asVoid(tabOf(page)),
      strain: (page) => tabOf(page).pipe(Effect.asVoid, Effect.withSpan('ManagedHost.strain')),
      geolocation: Effect.fn('ManagedHost.geolocation')(function* (page) {
        const { state, service } = yield* serviceOf(page);
        yield* state.permissions.geolocation(service);
      }),
      session: Effect.fn('ManagedHost.session')(function* (page) {
        const { state, tab } = yield* tabOf(page);
        const at = located.get(page)!;
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            tab.sessions += 1;
          }),
          () =>
            Effect.map(Clock.currentTimeMillis, (now) => {
              tab.sessions -= 1;
              tab.quietSince = now;
            }),
        );
        const { sessionId } = yield* state.connection.root
          .send('Target.attachToTarget', { targetId: at.target, flatten: true })
          .pipe(Effect.mapError(lost));
        yield* Effect.addFinalizer(() =>
          state.connection.root.send('Target.detachFromTarget', { sessionId }).pipe(
            Effect.catchTags({
              SessionEnded: () => Effect.void,
              CommandRefused: (refusal) =>
                Effect.logDebug(`managed browser: the session of page ${page} was already detached: ${refusal.message}`),
            }),
            Effect.orDie,
          ),
        );
        return yield* state.connection.attach(sessionId);
      }),
    },
    profiles: {
      prepare: (profile) => Effect.asVoid(ensure(profile)),
      session: Effect.fn('ManagedHost.profileSession')(function* (profile) {
        return yield* hiddenTarget(yield* ensure(profile));
      }),
      remove: Effect.fn('ManagedHost.remove')(function* (profile) {
        const state = running.get(profile);
        if (state !== undefined) yield* gone(state);
        yield* Effect.all([
          files.remove(path.join(place.profiles, profile), { recursive: true, force: true }),
          files.remove(path.join(place.downloads, profile), { recursive: true, force: true }),
        ]).pipe(Effect.mapError((failure) => refused(`the storage of profile ${profile} could not be removed: ${failure.message}`)));
      }),
    },
    capture: captureHost(ensure),
  };
  return host;
});

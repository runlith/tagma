import { Clock, Deferred, Effect, Exit, FileSystem, Layer, Path, PubSub, Scope, Stream } from 'effect';
import { BrowserPlace, capturesOf, chosenOf } from './contract/service/place.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Settings } from '../settings/contract/service/values.js';
import { type Host, HostAdapters, Hosts, type Moved, type ProfileRecord, type Signal } from './contract/service/hosts.js';
import type { HostEvent, PageChange } from './contract/wire/host.js';
import { type FrameTarget, hostRefusal, type Opener, type PageRefusal, Pages } from './contract/service/pages.js';
import { PageId, type ProfileId } from './contract/wire/ids.js';
import type { Download, Glance, Live, Page, PagesEvent, PageState } from './contract/wire/page.js';
import { DOWNLOADS_KEPT } from './contract/wire/rows.js';
import { agentProfile, userProfile } from './contract/wire/settings.js';
import { Ledger, type PagePatch, type PageRow } from './store/ledger.js';

type Held = { row: PageRow; live: Live; holder: Host | null };

const QUIET: Live = {
  loading: false,
  back: false,
  forward: false,
  crashed: false,
  responsive: true,
  dialog: null,
  driven: null,
  shown: false,
};

const ACTIVE_WRITE_MS = 10_000;

export const makePages = Effect.gen(function* () {
  const ledger = yield* Ledger;
  const hosts = yield* Hosts;
  const adapters = yield* HostAdapters;
  const settings = yield* Settings;
  const place = yield* BrowserPlace;
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;

  const held = new Map<PageId, Held>();
  const unresponsive = new Map<PageId, Map<string, FrameTarget | null>>();
  const byThread = new Map<string, PageId>();
  const profiles = new Map<ProfileId, ProfileRecord>();
  const prepared = new WeakMap<Host, Set<ProfileId>>();
  const restoring = new Map<PageId, Deferred.Deferred<Host, StoreFailure | GateRefusal<PageRefusal>>>();
  const hostScopes = new Map<Host, Scope.Closeable>();
  const published = yield* PubSub.unbounded<{ readonly projectId: number; readonly event: PagesEvent }>();
  const moved = yield* PubSub.unbounded<{ readonly page: PageId; readonly moved: Moved }>();

  for (const row of yield* Effect.orDie(ledger.openPages)) held.set(row.id, { row, live: QUIET, holder: null });

  const profileOf = Effect.fnUntraced(function* (id: ProfileId) {
    const known = profiles.get(id);
    if (known !== undefined) return known;
    const row = yield* ledger.profile(id);
    if (row !== undefined) profiles.set(id, row);
    return row;
  });

  const adapterOf = (page: Held): string | undefined => profiles.get(page.row.profile)?.adapter;

  const stateOf = (page: Held): PageState => {
    if (page.holder !== null) return 'live';
    const adapter = adapterOf(page);
    return adapter !== undefined && [...hostScopes.keys()].some((host) => host.adapter === adapter) ? 'dormant' : 'away';
  };

  const wire = (page: Held): Page => ({
    id: page.row.id,
    projectId: page.row.projectId,
    profile: page.row.profile,
    url: page.row.url,
    title: page.row.title,
    favicon: page.row.favicon,
    openedBy: page.row.openedBy,
    opener: page.row.opener,
    state: stateOf(page),
    host: page.holder?.id ?? null,
    live: page.live,
    downloads: page.row.downloads.length,
    activeAt: page.row.activeAt.toISOString(),
    closedAt: page.row.closedAt?.toISOString() ?? null,
  });

  const move = (page: Held, signal: Signal) => {
    const change: { readonly page: PageId; readonly moved: Moved } = { page: page.row.id, moved: { live: page.live, signal } };
    return PubSub.publish(moved, change);
  };

  const announce = (page: Held, event: PagesEvent) => {
    const change: { readonly projectId: number; readonly event: PagesEvent } = { projectId: page.row.projectId, event };
    return PubSub.publish(published, change);
  };

  const publish = (page: Held, signal: Signal = 'changed') =>
    Effect.andThen(announce(page, { type: 'put', page: wire(page) }), move(page, signal));

  const forget = Effect.fnUntraced(function* (page: Held) {
    held.delete(page.row.id);
    unresponsive.delete(page.row.id);
    for (const [thread, id] of byThread) if (id === page.row.id) byThread.delete(thread);
    yield* announce(page, { type: 'gone', id: page.row.id });
    yield* move(page, 'closed');
    for (const dir of [capturesOf(path, place, page.row.id), chosenOf(path, place, page.row.id)]) {
      yield* files
        .remove(dir, { recursive: true, force: true })
        .pipe(Effect.catchTag('PlatformError', (failure) => Effect.logWarning(`browser: ${dir} was not removed: ${failure.message}`)));
    }
  });

  const persist = (page: Held, patch: PagePatch) =>
    Effect.andThen(
      Effect.sync(() => {
        page.row = { ...page.row, ...patch };
      }),
      ledger.changePage(page.row.id, patch),
    );

  const prepare = Effect.fnUntraced(function* (host: Host, profile: ProfileRecord) {
    const ready = prepared.get(host) ?? new Set<ProfileId>();
    prepared.set(host, ready);
    if (ready.has(profile.id)) return;
    yield* host.profiles.prepare(profile);
    ready.add(profile.id);
  });

  const connectedProfiles = Effect.fnUntraced(function* () {
    const rows = yield* ledger.profiles;
    const connected = hosts.adapters();
    return rows.filter((row) => row.removal === null && connected.has(row.adapter)).map((row) => row.id);
  });

  const awayRefusal = Effect.fnUntraced(function* (profile: ProfileRecord) {
    const ready = yield* connectedProfiles();
    const hint = adapters.all.find((adapter) => adapter.id === profile.adapter)?.away;
    return new GateRefusal<PageRefusal>(
      'host-away',
      `the host of profile ${profile.id} (${profile.adapter}) is not connected; nothing was opened in another profile`,
      [
        ready.length === 0
          ? 'no browser host is connected to this server now'
          : `name one of the profiles whose host is connected: ${ready.join(', ')}`,
        ...(hint === undefined ? [] : [hint]),
      ],
    );
  });

  const reachHost = Effect.fnUntraced(function* (profile: ProfileRecord) {
    const host = yield* hosts
      .reach(profile.adapter)
      .pipe(Effect.catchTag('HostAway', () => Effect.flatMap(awayRefusal(profile), Effect.fail)));
    yield* prepare(host, profile).pipe(Effect.mapError(hostRefusal));
    return host;
  });

  const unknownProfile = Effect.fnUntraced(function* (id: ProfileId) {
    const ready = yield* connectedProfiles();
    return new GateRefusal<PageRefusal>('profile-unknown', `no browser profile ${id} stands on this machine`, [
      ready.length === 0 ? 'make a profile with create_profile' : `name one of the profiles whose host is connected: ${ready.join(', ')}`,
    ]);
  });

  const touch = Effect.fnUntraced(function* (page: Held, thread: string | null) {
    if (thread !== null) byThread.set(thread, page.row.id);
    const now = yield* Clock.currentTimeMillis;
    if (now - page.row.activeAt.getTime() > ACTIVE_WRITE_MS) yield* persist(page, { activeAt: new Date(now) });
  });

  const open = Effect.fn('Pages.open')(function* (
    opener: Opener,
    input: { readonly url: string; readonly profile: ProfileId | undefined },
  ) {
    const id = input.profile ?? (yield* settings.value(opener.human ? userProfile : agentProfile, opener.projectId));
    const profile = yield* profileOf(id);
    if ((profile === undefined || profile.removal === 'delete') && input.profile === undefined) {
      const ready = yield* connectedProfiles();
      return yield* new GateRefusal<PageRefusal>(
        'host-away',
        `the default profile ${id} stands on no host connected to this server; nothing was opened in another profile`,
        [
          ready.length === 0
            ? 'no browser host is connected to this server now'
            : `name one of the profiles whose host is connected: ${ready.join(', ')}`,
        ],
      );
    }
    if (profile === undefined || profile.removal === 'delete') return yield* Effect.flatMap(unknownProfile(id), Effect.fail);
    const host = yield* reachHost(profile);
    const now = new Date(yield* Clock.currentTimeMillis);
    const row: PageRow = {
      id: PageId.make(Bun.randomUUIDv7()),
      projectId: opener.projectId,
      profile: profile.id,
      context: null,
      url: input.url,
      title: '',
      favicon: null,
      openedBy: opener.thread,
      opener: null,
      history: null,
      downloads: [],
      activeAt: now,
      closedAt: null,
    };
    yield* ledger.putPage(row);
    const page: Held = { row, live: { ...QUIET, loading: true }, holder: host };
    held.set(row.id, page);
    yield* host.pages.open({ page: row.id, profile, context: null, url: input.url, history: null }).pipe(
      Effect.tapError((failure) =>
        failure._tag === 'HostLost' && failure.pending
          ? Effect.suspend(() => {
              page.holder = null;
              page.live = { ...QUIET };
              if (opener.thread !== null) byThread.set(opener.thread, row.id);
              return publish(page);
            })
          : Effect.andThen(Effect.orDie(ledger.dropPage(row.id)), forget(page)),
      ),
      Effect.mapError(hostRefusal),
    );
    if (opener.thread !== null) byThread.set(opener.thread, row.id);
    yield* publish(page);
    return wire(page);
  });

  const unknownPage = (id: PageId | undefined) =>
    new GateRefusal(
      'page-unknown',
      id === undefined ? 'this caller has worked with no page yet' : `no open page ${id} stands in this project`,
      ['list_pages — the open pages of this project', 'open_page — open one'],
    );

  const resolve = Effect.fn('Pages.resolve')(function* (opener: Opener, id: PageId | undefined) {
    const named = id ?? (opener.thread === null ? undefined : byThread.get(opener.thread));
    const page = named === undefined ? undefined : held.get(named);
    if (page === undefined || page.row.projectId !== opener.projectId) return yield* unknownPage(id);
    yield* touch(page, opener.thread);
    return wire(page);
  });

  const close = Effect.fn('Pages.close')(function* (id: PageId) {
    const page = held.get(id);
    if (page === undefined) return yield* unknownPage(id);
    if (page.holder !== null) {
      yield* page.holder.pages.close(id, page.live.responsive && !page.live.crashed).pipe(
        Effect.catchTags({
          HostLost: (lost) => Effect.fail(hostRefusal(lost)),
          HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
        }),
        Effect.catchTag('PageStayed', (stayed) =>
          Effect.fail(
            new GateRefusal('page-stayed', `page ${id} stays open: ${stayed.message}`, [
              'close_page again and accept its leave dialog with answer_page_dialog',
            ]),
          ),
        ),
      );
    }
    yield* ledger.closePages([id], new Date(yield* Clock.currentTimeMillis));
    yield* forget(page);
  });

  const restore = Effect.fnUntraced(function* (page: Held) {
    const profile = yield* profileOf(page.row.profile);
    if (profile === undefined) return yield* Effect.flatMap(unknownProfile(page.row.profile), Effect.fail);
    const host = yield* reachHost(profile);
    if (page.holder !== null) return page.holder;
    yield* host.pages
      .open({ page: page.row.id, profile, context: page.row.context, url: page.row.url, history: page.row.history })
      .pipe(Effect.mapError(hostRefusal));
    page.holder = host;
    page.live = { ...QUIET, loading: true };
    yield* publish(page);
    return host;
  });

  const hold = Effect.fn('Pages.hold')(function* (id: PageId) {
    const page = held.get(id);
    if (page === undefined) return yield* unknownPage(id);
    if (page.holder !== null) return page.holder;
    const running = restoring.get(id);
    if (running !== undefined) return yield* Deferred.await(running);
    const done = yield* Deferred.make<Host, StoreFailure | GateRefusal<PageRefusal>>();
    restoring.set(id, done);
    return yield* restore(page).pipe(
      Effect.onExit((exit) =>
        Effect.andThen(
          Deferred.done(done, exit),
          Effect.sync(() => restoring.delete(id)),
        ),
      ),
    );
  });

  const changed = Effect.fnUntraced(function* (page: Held, change: PageChange) {
    const patch: PagePatch = {};
    if (change.url !== undefined && change.url !== page.row.url) Object.assign(patch, { url: change.url });
    if (change.title !== undefined && change.title !== page.row.title) Object.assign(patch, { title: change.title });
    if (change.favicon !== undefined && change.favicon !== page.row.favicon) Object.assign(patch, { favicon: change.favicon });
    if (change.history !== undefined) Object.assign(patch, { history: change.history });
    if (Object.keys(patch).length > 0) yield* persist(page, patch);
    page.live = {
      ...page.live,
      loading: change.loading ?? page.live.loading,
      back: change.back ?? page.live.back,
      forward: change.forward ?? page.live.forward,
      crashed: change.loading === true ? false : page.live.crashed,
    };
  });

  const adoptPopup = Effect.fnUntraced(function* (host: Host, event: Extract<HostEvent, { readonly kind: 'opened' }>) {
    const opener = event.opener === null ? undefined : held.get(event.opener);
    if (opener === undefined) return;
    const now = new Date(yield* Clock.currentTimeMillis);
    const row: PageRow = {
      id: PageId.make(Bun.randomUUIDv7()),
      projectId: opener.row.projectId,
      profile: event.profile,
      context: opener.row.context,
      url: event.url,
      title: '',
      favicon: null,
      openedBy: opener.row.openedBy,
      opener: opener.row.id,
      history: null,
      downloads: [],
      activeAt: now,
      closedAt: null,
    };
    yield* ledger.putPage(row);
    const page: Held = { row, live: { ...QUIET, loading: true }, holder: host };
    held.set(row.id, page);
    const adopted = yield* host.pages.adopt(event.local, row.id).pipe(
      Effect.as(true),
      Effect.catchTags({
        HostLost: (lost) => Effect.as(Effect.logWarning(`browser: popup ${event.local} was not adopted: ${lost.message}`), false),
        HostRefused: (refused) => Effect.as(Effect.logWarning(`browser: popup ${event.local} was not adopted: ${refused.message}`), false),
        PageMissing: (missing) =>
          Effect.as(Effect.logInfo(`browser: popup ${event.local} closed before adoption: ${missing.message}`), false),
      }),
    );
    if (!adopted) {
      yield* ledger.dropPage(row.id);
      held.delete(row.id);
      return;
    }
    yield* publish(page);
  });

  const upsertDownload = (downloads: readonly Download[], download: Download): readonly Download[] => {
    const at = downloads.findIndex((held) => held.id === download.id);
    if (at >= 0) return downloads.map((held, index) => (index === at ? download : held));
    return [...downloads, download].sort((one, other) => one.at.localeCompare(other.at)).slice(-DOWNLOADS_KEPT);
  };

  const respond = (page: Held, responsive: boolean, frame?: FrameTarget): void => {
    const key = frame === undefined ? 'host' : `frame:${frame.session}`;
    const silent = unresponsive.get(page.row.id) ?? new Map<string, FrameTarget | null>();
    if (responsive) silent.delete(key);
    else silent.set(key, frame ?? null);
    if (silent.size === 0) unresponsive.delete(page.row.id);
    else unresponsive.set(page.row.id, silent);
    page.live = { ...page.live, responsive: silent.size === 0 };
  };

  const arrive = Effect.fnUntraced(function* (host: Host, event: HostEvent) {
    if (event.kind === 'opened') return yield* adoptPopup(host, event);
    const page = held.get(event.page);
    if (page === undefined) return;
    switch (event.kind) {
      case 'changed':
        yield* changed(page, event.change);
        return yield* publish(page);
      case 'swapped':
        return yield* publish(page, 'swapped');
      case 'released':
        return yield* publish(page, 'released');
      case 'unresponsive':
      case 'responsive':
        respond(page, event.kind === 'responsive');
        return yield* publish(page);
      case 'crashed':
        page.live = { ...page.live, crashed: true, loading: false };
        return yield* publish(page);
      case 'dialog':
        page.live = { ...page.live, dialog: event.dialog };
        return yield* publish(page);
      case 'download':
        yield* persist(page, { downloads: upsertDownload(page.row.downloads, event.download) });
        return yield* announce(page, { type: 'put', page: wire(page) });
      case 'closed':
        yield* ledger.closePages([page.row.id], new Date(yield* Clock.currentTimeMillis));
        return yield* forget(page);
      case 'dropped':
        unresponsive.delete(page.row.id);
        page.holder = null;
        page.live = { ...QUIET };
        return yield* publish(page, 'dropped');
    }
  });

  const reconcile = Effect.fnUntraced(function* (host: Host) {
    const live = yield* host.pages.live.pipe(
      Effect.catchTags({
        HostLost: (lost) => Effect.as(Effect.logWarning(`browser: host ${host.id} lost before its pages were read: ${lost.message}`), []),
        HostRefused: (refused) => Effect.as(Effect.logWarning(`browser: host ${host.id} refused its page list: ${refused.message}`), []),
      }),
    );
    for (const standing of live) {
      const page = standing.page === null ? undefined : held.get(standing.page);
      if (page !== undefined) {
        page.holder = host;
        yield* Effect.orDie(changed(page, { url: standing.url, title: standing.title }));
      } else if (standing.page !== null)
        yield* host.pages.close(standing.page, false).pipe(
          Effect.catchTags({
            HostLost: (lost) => Effect.logWarning(`browser: host ${host.id} lost while closing a page it no longer owns: ${lost.message}`),
            HostRefused: (refused) => Effect.logWarning(`browser: host ${host.id} kept page ${standing.page}: ${refused.message}`),
            PageStayed: (stayed) => Effect.logWarning(`browser: host ${host.id} kept page ${standing.page}: ${stayed.message}`),
          }),
        );
      else
        yield* Effect.orDie(
          adoptPopup(host, {
            kind: 'opened',
            local: standing.local,
            profile: standing.profile,
            opener: standing.opener,
            url: standing.url,
          }),
        );
    }
    for (const page of held.values()) if (adapterOf(page) === host.adapter || page.holder === host) yield* publish(page);
  });

  yield* hosts.watch({
    attached: Effect.fnUntraced(function* (host) {
      const hostScope = yield* Scope.fork(scope);
      hostScopes.set(host, hostScope);
      const events = yield* Scope.provide(host.pages.events, hostScope);
      for (const row of yield* Effect.orDie(ledger.profiles)) profiles.set(row.id, row);
      yield* Stream.runForEach(events, (event) =>
        arrive(host, event).pipe(
          Effect.catchTags({
            SqlError: (failure) => Effect.logError(`browser: event ${event.kind} of host ${host.id} was not recorded: ${failure.message}`),
            EffectDrizzleQueryError: (failure) =>
              Effect.logError(`browser: event ${event.kind} of host ${host.id} was not recorded: ${failure.message}`),
          }),
        ),
      ).pipe(Effect.interruptible, Effect.forkIn(hostScope));
      yield* reconcile(host);
    }),
    detached: Effect.fnUntraced(function* (host) {
      const hostScope = hostScopes.get(host);
      hostScopes.delete(host);
      if (hostScope !== undefined) yield* Scope.close(hostScope, Exit.void);
      for (const page of held.values()) {
        if (page.holder === host) {
          unresponsive.delete(page.row.id);
          page.holder = null;
          page.live = { ...QUIET };
        }
        if (adapterOf(page) === host.adapter) yield* publish(page);
      }
    }),
  });

  return Pages.of({
    open,
    resolve,
    close,
    list: Effect.fn('Pages.list')(function* (projectId, walk) {
      const listed = yield* ledger.walk(projectId, walk);
      for (const row of listed.rows) if (!profiles.has(row.profile)) yield* profileOf(row.profile);
      return {
        pages: listed.rows.map((row) => wire(held.get(row.id) ?? { row, live: QUIET, holder: null })),
        total: listed.total,
      };
    }),
    hold,
    live: (id) => held.get(id)?.live,
    mark: (id, change, frame) =>
      Effect.suspend(() => {
        const page = held.get(id);
        if (page === undefined) return Effect.void;
        page.live = { ...page.live, ...change };
        if (change.responsive !== undefined) respond(page, change.responsive, frame);
        return publish(page);
      }),
    hungFrame: (id) => {
      for (const frame of unresponsive.get(id)?.values() ?? []) if (frame !== null) return frame;
      return undefined;
    },
    inProfile: (profile) => [...held.values()].filter((page) => page.row.profile === profile).map(wire),
    commit: (id, change) =>
      Effect.suspend(() => {
        const page = held.get(id);
        return page === undefined ? Effect.void : Effect.andThen(changed(page, change), publish(page));
      }),
    glance: (id, navigated): Glance => {
      const page = held.get(id);
      return {
        id,
        url: page?.row.url ?? '',
        title: page?.row.title ?? '',
        loading: page?.live.loading ?? false,
        dialog: page?.live.dialog ?? null,
        navigated,
      };
    },
    changes: Effect.fnUntraced(function* (projectId) {
      const subscription = yield* PubSub.subscribe(published);
      const list: PagesEvent = { type: 'list', pages: [...held.values()].filter((page) => page.row.projectId === projectId).map(wire) };
      const later = Stream.fromSubscription(subscription).pipe(
        Stream.filter((change) => change.projectId === projectId),
        Stream.map((change) => change.event),
      );
      return Stream.concat(Stream.make(list), later);
    }),
    moves: (id) =>
      Effect.map(PubSub.subscribe(moved), (subscription) =>
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((change) => change.page === id),
          Stream.map((change) => change.moved),
        ),
      ),
    profileOf: (id) => held.get(id)?.row.profile,
    urlOf: (id) => held.get(id)?.row.url ?? '',
    downloads: (id) =>
      Effect.suspend(() => {
        const page = held.get(id);
        return page === undefined ? Effect.fail(unknownPage(id)) : Effect.succeed(page.row.downloads);
      }),
    closeProfile: Effect.fn('Pages.closeProfile')(function* (profile) {
      const closing = [...held.values()].filter((page) => page.row.profile === profile);
      for (const page of closing) {
        if (page.holder === null) continue;
        yield* page.holder.pages.close(page.row.id, false).pipe(
          Effect.catchTags({
            HostLost: (lost) => Effect.logWarning(`browser: closing page ${page.row.id} reached no host: ${lost.message}`),
            HostRefused: (refused) => Effect.logWarning(`browser: the host refused to close page ${page.row.id}: ${refused.message}`),
            PageStayed: (stayed) => Effect.logWarning(`browser: page ${page.row.id} stayed open: ${stayed.message}`),
          }),
        );
      }
      yield* ledger.closePages(
        closing.map((page) => page.row.id),
        new Date(yield* Clock.currentTimeMillis),
      );
      for (const page of closing) yield* forget(page);
      profiles.delete(profile);
      for (const host of hostScopes.keys()) prepared.get(host)?.delete(profile);
    }),
  });
});

export const pagesLayer = Layer.effect(Pages, makePages);

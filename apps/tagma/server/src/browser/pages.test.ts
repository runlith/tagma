import { expect } from 'bun:test';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@runlith/effect-test';
import * as Memory from '@runlith/testbed/memory';
import { Context, Deferred, Effect, Layer, PubSub, Schema, Stream } from 'effect';
import { forProject } from '../invocation/testing/call.js';
import { Settings } from '../settings/contract/service/values.js';
import type { Refused } from '../platform/contract/service/body.js';
import type { DeclaredAnswer } from '../platform/contract/wire/operation.js';
import type { CurrentProject } from '../projects/contract/service/caller.js';
import type { PAGE_OPERATIONS } from './contract/wire/pageOperations.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { Automation } from './contract/service/automation.js';
import { type Host, HostAdapters, Hosts, NavigationFailed } from './contract/service/hosts.js';
import { Pages } from './contract/service/pages.js';
import { BrowserPlace } from './contract/service/place.js';
import { Profiles } from './contract/service/profiles.js';
import { ThreadRuns } from './contract/service/runs.js';
import { ServedRoots } from './contract/service/sources.js';
import { PageId, ProfileId } from './contract/wire/ids.js';
import type { HostEvent } from './contract/wire/host.js';
import { makeAutomation } from './engine/automation.js';
import { makeDrive } from './engine/drive.js';
import { makeHosts } from './hosts.js';
import { PAGE_PAIRS } from './operations.js';
import { makePages } from './pages.js';
import { Ledger, type PageRow, type ProfileRow } from './store/ledger.js';

type Navigate = typeof PAGE_OPERATIONS.navigate_page;
type Call = Effect.Effect<DeclaredAnswer<Navigate['answer']>, Refused<Navigate>, Pages | Automation | CurrentProject>;

const unused = () => Effect.die('this scenario does not use this port');

it.effect('operator navigation releases reconciled host policies and ignores an older restriction event', () =>
  Effect.gen(function* () {
    const page = PageId.make('01a184cf-76ca-7d83-87c6-2f78805e2612');
    const profile = ProfileId.make('test');
    const row: PageRow = {
      id: page,
      projectId: 1,
      profile,
      context: null,
      url: 'https://allowed.example/',
      title: '',
      favicon: null,
      openedBy: 'agent',
      opener: null,
      history: null,
      downloads: [],
      activeAt: new Date(0),
      closedAt: null,
    };
    const record: ProfileRow = {
      id: profile,
      name: 'Test',
      adapter: 'desktop',
      document: {},
      console: 'never',
      removal: null,
      createdAt: new Date(0),
    };
    let restricted = true;
    let revision = 3;
    const messages = yield* PubSub.unbounded<HostEvent>();
    const delivered = yield* Deferred.make<void>();
    const host: Host = {
      id: 'desktop',
      adapter: 'desktop',
      pid: null,
      native: true,
      capture: null,
      pages: {
        open: unused,
        adopt: unused,
        close: unused,
        pdf: unused,
        answer: unused,
        paint: unused,
        session: unused,
        strain: unused,
        geolocation: unused,
        live: Effect.sync(() => [
          { page, local: 'retained', profile, url: row.url, title: '', opener: null, restriction: { restricted, revision } },
        ]),
        events: Effect.map(PubSub.subscribe(messages), (subscription) =>
          Stream.fromSubscription(subscription).pipe(Stream.take(1), Stream.ensuring(Deferred.succeed(delivered, undefined))),
        ),
        navigation: (_page, policy) =>
          Effect.sync(() => {
            if (restricted !== (policy !== null)) revision += 1;
            restricted = policy !== null;
            return { changes: [{ page, restricted, revision }], blocked: Effect.never, check: Effect.void };
          }),
        navigate: (_page, to) =>
          restricted
            ? Effect.fail(
                new NavigationFailed({ code: 'ERR_BLOCKED_BY_CLIENT', message: 'the retained agent policy blocked this address' }),
              )
            : Effect.succeed({ url: to.kind === 'url' ? to.url : row.url }),
      },
      profiles: { prepare: unused, session: unused, remove: unused },
    };
    const ledger = Ledger.of({
      profiles: Effect.succeed([record]),
      profile: () => Effect.succeed(record),
      openPages: Effect.succeed([row]),
      changePage: () => Effect.void,
      seed: unused,
      putProfile: unused,
      changeProfile: unused,
      markProfile: unused,
      dropProfile: unused,
      page: unused,
      putPage: unused,
      dropPage: unused,
      closePages: unused,
      walk: unused,
    });
    const settings = Settings.of({
      value: unused,
      read: unused,
      chain: unused,
      live: unused,
      held: (key) =>
        Schema.decodeUnknownEffect(key.schema)(key.id === 'browser.blockedDomains' ? ['blocked.example'] : key.fallback).pipe(
          Effect.orDie,
          Effect.map((value) => () => value),
        ),
      changes: unused,
      write: unused,
      amend: unused,
    });
    const profiles = Profiles.of({
      list: unused(),
      record: unused,
      chosen: unused,
      create: unused,
      update: unused,
      remove: unused,
      clear: unused,
      connected: unused(),
      exclusive: unused,
      changes: Effect.succeed(Stream.empty),
    });
    const runs = ThreadRuns.of({ running: () => Effect.succeed(false), ending: () => Effect.succeed(Effect.never) });
    const hosts = yield* makeHosts;
    yield* hosts.attach(host);
    const platform = yield* Layer.build(Layer.mergeAll(Memory.layer, BunPath.layer));
    const context = platform.pipe(
      Context.add(Ledger, ledger),
      Context.add(Hosts, hosts),
      Context.add(HostAdapters, { all: [] }),
      Context.add(Settings, settings),
      Context.add(BrowserPlace, { root: '/browser' }),
      Context.add(Profiles, profiles),
      Context.add(ThreadRuns, runs),
      Context.add(CheckoutPaths, {
        pathWithin: unused,
        placeOf: unused,
        placeAcross: unused,
        resourceAcross: unused,
        rootAcross: unused,
        rootsWithin: unused,
      }),
      Context.add(ServedRoots, { root: unused }),
    );
    const pages = yield* Effect.provide(makePages, context);
    const drive = yield* makeDrive({ pages, profiles, runs });
    const automation = yield* Effect.provide(makeAutomation({ drive }), Context.add(context, Pages, pages));
    const navigating = PAGE_PAIRS.navigate_page.body.execute({ page, url: 'https://blocked.example/next' }, undefined, {
      actor: { kind: 'operator' },
      files: null,
    }) as Call;
    const perform = navigating.pipe(
      forProject(Effect.succeed({ project: { id: 1, name: 'browser' } })),
      Effect.provideService(Pages, pages),
      Effect.provideService(Automation, automation),
    );
    expect((yield* perform).page.url).toBe('https://blocked.example/next');
    const older = revision;
    yield* Effect.scoped(pages.navigation(page, true));
    yield* PubSub.publish(messages, { kind: 'restrictions', changes: [{ page, restricted: false, revision: older }] });
    yield* Deferred.await(delivered);
    expect((yield* perform).page.url).toBe('https://blocked.example/next');
  }),
);

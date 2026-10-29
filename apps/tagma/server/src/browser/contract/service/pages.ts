import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PageId, ProfileId } from '../wire/ids.js';
import type { Download, Glance, Live, Page, PagesEvent } from '../wire/page.js';
import type { PageChange } from '../wire/host.js';
import type { DomainPolicy } from '../wire/domains.js';
import type { Host, HostFailure, Moved, NavigationWatch } from './hosts.js';

export type PageRefusal = 'page-unknown' | 'host-away' | 'profile-unknown' | 'host-refused' | 'outcome-unknown' | 'domain-blocked';
export type ReleaseRefusal = 'page-unknown' | 'host-away' | 'host-refused' | 'outcome-unknown';

export const outcomeUnknown = (message: string): GateRefusal<'outcome-unknown'> =>
  new GateRefusal('outcome-unknown', `the call reached the page host, but its outcome is unknown: ${message}`, [
    'snapshot_page — reconnect and see whether the call took effect before making it again',
  ]);

export const hostRefusal = (failure: HostFailure): GateRefusal<'host-refused' | 'outcome-unknown' | 'host-away'> =>
  failure._tag === 'HostRefused'
    ? new GateRefusal('host-refused', failure.message, failure.unblock)
    : failure.pending
      ? outcomeUnknown(failure.message)
      : new GateRefusal('host-away', `the page host stopped answering: ${failure.message}`, ['make the call again once the host is back']);

export type Opener = { readonly projectId: number; readonly thread: string | null; readonly human: boolean };

export type Listing = { readonly pages: readonly Page[]; readonly total: number };

export type FrameTarget = { readonly session: string; readonly frame: string; readonly url: string };

export type Walk = {
  readonly closed: boolean;
  readonly limit: number;
  readonly after: { readonly at: number; readonly id: string } | null;
};

export class Pages extends Context.Service<
  Pages,
  {
    open(
      opener: Opener,
      input: { readonly url: string; readonly profile: ProfileId | undefined },
    ): Effect.Effect<Page, StoreFailure | GateRefusal<PageRefusal>>;
    resolve(opener: Opener, page: PageId | undefined): Effect.Effect<Page, StoreFailure | GateRefusal<'page-unknown'>>;
    close(
      page: PageId,
    ): Effect.Effect<void, StoreFailure | GateRefusal<'page-unknown' | 'page-stayed' | 'host-refused' | 'outcome-unknown' | 'host-away'>>;
    list(projectId: number, walk: Walk): Effect.Effect<Listing, StoreFailure>;
    hold(page: PageId, policy?: DomainPolicy | null): Effect.Effect<Host, StoreFailure | GateRefusal<PageRefusal>>;
    navigation(page: PageId, agent: boolean): Effect.Effect<NavigationWatch, StoreFailure | GateRefusal<PageRefusal>, Scope.Scope>;
    live(page: PageId): Live | undefined;
    operate(page: PageId): Effect.Effect<void, GateRefusal<ReleaseRefusal>>;
    operated(page: PageId): number | undefined;
    mark(page: PageId, change: Partial<Live>, frame?: FrameTarget): Effect.Effect<void>;
    hungFrame(page: PageId): FrameTarget | undefined;
    inProfile(profile: ProfileId): readonly Page[];
    commit(page: PageId, change: PageChange): Effect.Effect<void, StoreFailure>;
    glance(page: PageId, navigated: boolean): Glance;
    changes(projectId: number): Effect.Effect<Stream.Stream<PagesEvent>, never, Scope.Scope>;
    moves(page: PageId): Effect.Effect<Stream.Stream<Moved>, never, Scope.Scope>;
    profileOf(page: PageId): ProfileId | undefined;
    urlOf(page: PageId): string;
    downloads(page: PageId): Effect.Effect<readonly Download[], StoreFailure | GateRefusal<'page-unknown'>>;
    closeProfile(profile: ProfileId): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/browser/Pages') {}

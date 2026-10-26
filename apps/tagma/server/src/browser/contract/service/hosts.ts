import type { Session } from '@runlith/cdp/session';
import { Context, Data, type Effect, type Schema, type Scope, type Stream } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { Unblock } from '../../../platform/contract/wire/refusal.js';
import type { HostEvent, LivePage, Navigation, PageChange } from '../wire/host.js';
import type { PageId, ProfileId } from '../wire/ids.js';
import type { History, Live } from '../wire/page.js';
import type { ConsoleCapture, Removal } from '../wire/profile.js';

export type ProfileRecord = {
  readonly id: ProfileId;
  readonly name: string;
  readonly adapter: string;
  readonly document: unknown;
  readonly console: ConsoleCapture;
  readonly removal: Removal | null;
  readonly createdAt: Date;
};

export class HostRefused extends Data.TaggedError('HostRefused')<{
  readonly message: string;
  readonly unblock: Unblock;
}> {}

export class HostLost extends Data.TaggedError('HostLost')<{ readonly message: string; readonly pending: boolean }> {}

export class PageMissing extends Data.TaggedError('PageMissing')<{ readonly page: PageId; readonly message: string }> {}

export class NavigationFailed extends Data.TaggedError('NavigationFailed')<{ readonly code: string; readonly message: string }> {}

export class PageStayed extends Data.TaggedError('PageStayed')<{ readonly page: PageId; readonly message: string }> {}

export class DebuggerTaken extends Data.TaggedError('DebuggerTaken')<{ readonly page: PageId; readonly message: string }> {}

export type HostFailure = HostRefused | HostLost;

export type Opening = {
  readonly page: PageId;
  readonly profile: ProfileRecord;
  readonly context: string | null;
  readonly url: string;
  readonly history: History | null;
};

export type PageHost = {
  open(opening: Opening): Effect.Effect<void, HostFailure>;
  adopt(local: string, page: PageId): Effect.Effect<void, HostFailure | PageMissing>;
  close(page: PageId, ask: boolean): Effect.Effect<void, HostFailure | PageStayed>;
  readonly live: Effect.Effect<readonly LivePage[], HostFailure>;
  navigate(page: PageId, to: Navigation): Effect.Effect<PageChange, HostFailure | PageMissing | NavigationFailed>;
  pdf(page: PageId): Effect.Effect<Uint8Array, HostFailure | PageMissing>;
  answer(page: PageId, accept: boolean, text: string | undefined): Effect.Effect<void, HostFailure | PageMissing>;
  readonly events: Effect.Effect<Stream.Stream<HostEvent>, never, Scope.Scope>;
  paint(page: PageId): Effect.Effect<void, HostFailure | PageMissing, Scope.Scope>;
  session(page: PageId): Effect.Effect<Session, HostFailure | PageMissing | DebuggerTaken, Scope.Scope>;
};

export type ProfileHost = {
  prepare(profile: ProfileRecord): Effect.Effect<void, HostFailure>;
  session(profile: ProfileRecord): Effect.Effect<Session, HostFailure, Scope.Scope>;
  remove(profile: ProfileId): Effect.Effect<void, HostFailure>;
};

export type Canvas = { readonly width: number; readonly height: number; readonly scale: number };

export type CaptureHost = {
  target(canvas: Canvas): Effect.Effect<Session, HostFailure, Scope.Scope>;
};

export type Host = {
  readonly id: string;
  readonly adapter: string;
  readonly pid: number | null;
  readonly native: boolean;
  readonly pages: PageHost;
  readonly profiles: ProfileHost;
  readonly capture: CaptureHost | null;
};

export class HostAway extends Data.TaggedError('HostAway')<{ readonly adapter: string; readonly message: string }> {}

export type HostWatch = {
  attached(host: Host): Effect.Effect<void>;
  detached(host: Host): Effect.Effect<void>;
};

export class Hosts extends Context.Service<
  Hosts,
  {
    attach(host: Host): Effect.Effect<void, never, Scope.Scope>;
    reach(adapter: string): Effect.Effect<Host, HostAway>;
    connected(adapter: string): Host | undefined;
    readonly adapters: () => ReadonlySet<string>;
    watch(watch: HostWatch): Effect.Effect<void, never, Scope.Scope>;
  }
>()('tagma/browser/Hosts') {}

export type ProfileSeed = { readonly id: ProfileId; readonly name: string; readonly document: unknown };

export type HostAdapter = {
  readonly id: string;
  readonly title: string;
  readonly document: Schema.Codec<unknown, unknown>;
  readonly fallback: unknown;
  readonly seeds: readonly ProfileSeed[];
  readonly away: string;
};

export type Signal = 'changed' | 'swapped' | 'released' | 'dropped' | 'closed';

export type Moved = { readonly live: Live; readonly signal: Signal };

export const HOST_ADAPTERS = new ContributionPoint<HostAdapter>('browser/adapters');

export class HostAdapters extends Context.Service<HostAdapters, { readonly all: readonly HostAdapter[] }>()('tagma/browser/HostAdapters') {}

import { Context, type Effect, type Stream } from 'effect';
import type { AccessState, Blocked } from '../wire/access.js';

export class WantedSites extends Context.Service<WantedSites, { readonly names: Stream.Stream<ReadonlySet<string>> }>()(
  'tagma/remote/WantedSites',
) {}

export class PlacedSites extends Context.Service<
  PlacedSites,
  {
    site(name: string): AccessState;
    at(host: string | undefined): string | null;
    readonly moved: Stream.Stream<void>;
  }
>()('tagma/remote/PlacedSites') {}

export class TerminalSite extends Context.Service<TerminalSite, { origin(port: number): Effect.Effect<string, Blocked> }>()(
  'tagma/remote/TerminalSite',
) {}

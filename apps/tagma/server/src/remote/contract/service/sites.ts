import { Context, type Stream } from 'effect';
import type { AccessState } from '../wire/access.js';

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

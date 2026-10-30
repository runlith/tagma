import { Context, type Effect, type Stream } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { HarnessNotInstalled } from '../../../threads/contract/service/harness.js';
import type { HarnessAdapter } from './adapter.js';

export class HarnessAdapters extends Context.Service<
  HarnessAdapters,
  {
    find(id: string): HarnessAdapter | null;
    last(id: string): HarnessAdapter | null;
    at(directory: string): HarnessAdapter | null;
    row(id: string, install?: string | null): Effect.Effect<HarnessAdapter, HarnessNotInstalled>;
    all(): readonly HarnessAdapter[];
    readonly changes: Stream.Stream<void>;
    declared(providers: readonly HarnessProvider[], packages?: ReadonlyMap<string, string>): Effect.Effect<void>;
  }
>()('tagma/external-harnesses/HarnessAdapters') {}

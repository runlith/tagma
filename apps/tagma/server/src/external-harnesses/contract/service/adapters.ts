import { Context, type Effect, type Stream } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { HarnessNotInstalled } from '../../../threads/contract/service/harness.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import type { HarnessAdapter } from './adapter.js';

export class HarnessAdapters extends Context.Service<
  HarnessAdapters,
  {
    find(id: string): HarnessAdapter | null;
    last(id: string): HarnessAdapter | null;
    running(facet: ExternalSession): HarnessAdapter | null;
    runningRow(facet: ExternalSession): Effect.Effect<HarnessAdapter, HarnessNotInstalled>;
    row(id: string, install?: string | null): Effect.Effect<HarnessAdapter, HarnessNotInstalled>;
    all(): readonly HarnessAdapter[];
    readonly changes: Stream.Stream<void>;
    declared(providers: readonly HarnessProvider[], packages?: ReadonlyMap<string, string>): Effect.Effect<void>;
    version(directory: string, providers: readonly HarnessProvider[]): Effect.Effect<void>;
  }
>()('tagma/external-harnesses/HarnessAdapters') {}

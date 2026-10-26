import { Clock, Effect } from 'effect';
import { declare } from '@runlith/held/Held';
import type { MetadataPage } from './file.js';
import { METADATA_CADENCE, METADATA_CONCURRENCY } from './policy.js';

type Entry = {
  users: number;
  until: number;
  value: MetadataPage<string> | null;
  readonly read: () => Effect.Effect<MetadataPage<string>>;
};

const listingHeld = declare<string>({
  name: 'external-harnesses/metadata-command-listing',
  owner: 'external-harnesses',
  rank: 420,
  key: (key) => key,
  concurrency: 1,
  threshold: '30 seconds',
  ceilings: {
    hold: '1 minute',
    wait: '1 minute',
    leaves: 'a cut listing stops where it stood; the entry keeps its last cached page and the next reader runs the command again',
  },
  external: { named: "a terminal command listing the CLI's sessions", callsBack: false },
});

export class MetadataCommands {
  private readonly entries = new Map<string, Entry>();

  watch(key: string, read: () => Effect.Effect<MetadataPage<string>>) {
    const { entries } = this;
    return Effect.acquireRelease(
      Effect.uninterruptible(
        Effect.gen(function* () {
          let entry = entries.get(key);
          if (entry === undefined) {
            entry = { users: 0, until: 0, value: null, read };
            entries.set(key, entry);
          }
          entry.users++;
          const held = entry;
          return {
            key,
            entry: held,
            read: (): Effect.Effect<MetadataPage<string>> =>
              listingHeld
                .hold(
                  key,
                  Effect.gen(function* () {
                    const now = yield* Clock.currentTimeMillis;
                    if (held.value !== null && now < held.until) return held.value;
                    const value = yield* held.read();
                    held.until =
                      (yield* Clock.currentTimeMillis) +
                      (value._tag === 'Unreadable' ? METADATA_CADENCE / METADATA_CONCURRENCY : METADATA_CADENCE);
                    held.value = value;
                    return value;
                  }),
                )
                .pipe(
                  Effect.catchTags({
                    HoldStalled: () => Effect.succeed<MetadataPage<string>>({ _tag: 'Unreadable', reason: 'listing-busy' }),
                    HoldCut: () => Effect.succeed<MetadataPage<string>>({ _tag: 'Unreadable', reason: 'listing-cut' }),
                  }),
                  Effect.withSpan('HarnessMetadata.listing'),
                ),
          };
        }),
      ),
      (held) =>
        Effect.sync(() => {
          if (--held.entry.users === 0 && entries.get(held.key) === held.entry) entries.delete(held.key);
        }),
    );
  }
}

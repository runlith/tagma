import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Arbitrary, Effect } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { FROZEN } from '../installation/testing/frozen.js';
import { readFeed } from './feed.js';

const FEED = 'https://releases.example/latest/feed.json';

const serving = (text: string) => HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(text))));

const RELEASE = {
  release: '0.2.2',
  platforms: { 'darwin-arm64': { archive: `${FEED}/tagma-0.2.2-darwin-arm64.tar.gz`, sha256: 'a'.repeat(64), size: 1 } },
  irreversible: false,
  stores: { 'machine-store': ['baseline'], 'host-store': [], graph: [], journal: [] },
  changes: [{ store: 'search-index', release: '0.2.2' }],
};

it.effect('today reads every feed an issued release published, entry for entry', () =>
  Effect.gen(function* () {
    for (const shape of FROZEN) {
      for (const feed of yield* Arbitrary.sampleEffect(Arbitrary.schema(shape.feed), { count: 24, seed: 1 })) {
        const read = yield* readFeed(serving(JSON.stringify(feed)), FEED);
        expect(read.releases.length).toBe(feed.releases.length);
      }
    }
  }),
);

it.effect('an entry this release cannot read drops alone, and a feed with no entry it can read is refused', () =>
  Effect.gen(function* () {
    const later = { ...RELEASE, release: '0.3', platforms: 'one archive for every machine' };
    const read = yield* readFeed(serving(JSON.stringify({ releases: [later, { ...RELEASE, notes: 'a field from a later shape' }] })), FEED);
    expect(read.releases).toEqual([RELEASE]);

    const refused = yield* Effect.flip(readFeed(serving(JSON.stringify({ releases: [later] })), FEED));
    expect(refused.code).toBe('source-unreadable');
  }),
);

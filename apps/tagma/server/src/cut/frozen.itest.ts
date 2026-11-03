import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Arbitrary, Effect, FileSystem, Result, Schema } from 'effect';
import { IRREVERSIBLE_STORES } from '../installation/contract/wire/manifest.js';
import { FROZEN } from '../installation/testing/frozen.js';
import { recorded, ReleaseRecord } from './stage.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('frozen feed', (it) => {
  it.effect('every issued release reads the feed today’s cut writes', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-frozen-' });
      for (const record of yield* Arbitrary.sampleEffect(Arbitrary.schema(ReleaseRecord), { count: 24, seed: 1 })) {
        const irreversible = IRREVERSIBLE_STORES.map((store) => ({ store, release: record.release }));
        const text = yield* files.readFileString(yield* recorded(home, { ...record, irreversible }));
        for (const shape of FROZEN) {
          const read = Schema.decodeUnknownResult(Schema.fromJsonString(shape.feed))(text);
          expect(Result.isSuccess(read) ? undefined : read.failure.message).toBeUndefined();
        }
      }
    }),
  );
});

import { Effect, Exit, FileSystem } from 'effect';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MigrationChain, StoreBrand, StoreOpenFailure } from '../contract/service/store.js';
import { chain } from './chain.js';

const seedPaths = new Map<string, string>();

export const seedDatabase = Effect.fn('Store.seedDatabase')(function* (
  migrations: Pick<MigrationChain<StoreBrand>, 'folder' | 'seeds'>,
  applied: (path: string) => Effect.Effect<number, StoreOpenFailure>,
): Effect.fn.Return<string, StoreOpenFailure, FileSystem.FileSystem> {
  const key = `${migrations.seeds}\0${migrations.folder}`;
  const known = seedPaths.get(key);
  if (known !== undefined) return known;
  const fs = yield* FileSystem.FileSystem;
  const digest = createHash('sha256')
    .update(
      chain(migrations)
        .map((migration) => migration.hash)
        .join(''),
    )
    .digest('hex')
    .slice(0, 16);
  const shelf = migrations.seeds;
  yield* fs.makeDirectory(shelf, { recursive: true });
  const made = join(shelf, `tagma-seed-${digest}.sqlite`);
  const build = yield* fs.makeTempDirectory({ directory: shelf, prefix: 'tagma-seed-build-' });
  const mine = join(build, 'tagma.sqlite');
  if (yield* fs.exists(made)) {
    const candidate = join(build, 'candidate.sqlite');
    const carried = yield* Effect.exit(Effect.andThen(fs.copyFile(made, candidate), applied(candidate)));
    if (Exit.isSuccess(carried) && carried.value === chain(migrations).length) {
      seedPaths.set(key, made);
      yield* fs.remove(build, { recursive: true });
      return made;
    }
  }
  yield* applied(mine);
  yield* fs.rename(mine, made);
  seedPaths.set(key, made);
  yield* fs.remove(build, { recursive: true });
  return made;
});

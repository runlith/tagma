import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { MAPS } from './stage.js';

const COMPLETION = 'kept.json';

const Kept = Schema.Struct({ release: Schema.String, commit: Schema.String });
type KeptMaps = typeof Kept.Type;
const encodeKept = Schema.encodeSync(Schema.fromJsonString(Kept));

export const keepMaps = Effect.fn('installation.keepMaps')(function* (home: string, kept: string, one: KeptMaps) {
  const files = yield* FileSystem.FileSystem;
  const maps = join(kept, one.release);
  const staging = `${maps}.part`;
  yield* files.makeDirectory(kept, { recursive: true });
  yield* files.remove(staging, { recursive: true, force: true });
  yield* files.copy(join(home, MAPS), staging, { overwrite: true });
  yield* files.writeFileString(join(staging, COMPLETION), encodeKept(one));
  yield* files.remove(maps, { recursive: true, force: true });
  yield* files.rename(staging, maps);
  return maps;
});

export const keptMapsOf = Effect.fn('installation.keptMaps')(function* (kept: string, one: KeptMaps) {
  const files = yield* FileSystem.FileSystem;
  const maps = join(kept, one.release);
  if (!(yield* files.exists(maps))) return 'absent' as const;
  const completion = join(maps, COMPLETION);
  if (!(yield* files.exists(completion))) return 'unverified' as const;
  return (yield* files.readFileString(completion)) === encodeKept(one) ? ('complete' as const) : ('unverified' as const);
});

import { Effect, FileSystem } from 'effect';
import { SKILLS } from '../contract/wire/manifest.js';

const SOURCE = 'src/native-harness/skills';

const foldersIn = Effect.fnUntraced(function* (source: string) {
  const files = yield* FileSystem.FileSystem;
  return yield* Effect.filter(yield* files.readDirectory(source), (name) =>
    Effect.map(files.stat(`${source}/${name}`), (info) => info.type === 'Directory'),
  );
});

export const skillInputs = Effect.fnUntraced(function* (sourcePath: string) {
  const files = yield* FileSystem.FileSystem;
  const source = `${sourcePath}/${SOURCE}`;
  const found: string[] = [];
  for (const folder of yield* foldersIn(source)) {
    const entries = yield* files.readDirectory(`${source}/${folder}`, { recursive: true });
    const held = yield* Effect.filter(entries, (entry) =>
      Effect.map(files.stat(`${source}/${folder}/${entry}`), (info) => info.type === 'File'),
    );
    found.push(...held.map((entry) => `${source}/${folder}/${entry}`));
  }
  return found;
});

export const carrySkills = Effect.fnUntraced(function* (sourcePath: string, root: string) {
  const files = yield* FileSystem.FileSystem;
  const source = `${sourcePath}/${SOURCE}`;
  yield* files.makeDirectory(`${root}/${SKILLS}`, { recursive: true });
  for (const folder of yield* foldersIn(source)) yield* files.copy(`${source}/${folder}`, `${root}/${SKILLS}/${folder}`);
});

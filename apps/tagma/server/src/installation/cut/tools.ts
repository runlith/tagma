import { dirname } from 'node:path';
import { Effect, FileSystem, type PlatformError } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { RIPGREP_PART, TYPESCRIPT_COMPILER, TYPESCRIPT_PART } from '../contract/wire/layout.js';
import { type CommandUnavailable, output } from './command.js';
import type { PlatformPackages } from './locked.js';

export type ToolCarried = Effect.Effect<
  string,
  string | CommandUnavailable | PlatformError.PlatformError,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
>;

export type Tools = { readonly packages: string; readonly root: string; readonly platform: string; readonly carried: PlatformPackages };

const resolved = (what: string, specifier: string, from: string) =>
  Effect.try({
    try: () => Bun.resolveSync(specifier, from),
    catch: (error) => `${what} could not be resolved: ${String(error)}`,
  });

const runs = Effect.fnUntraced(function* (what: string, binary: string, root: string, from: string) {
  const ran = yield* output(binary, ['--version'], root, {});
  if (ran.status !== 0) return yield* Effect.fail(`the ${what} it carries does not run: ${ran.text.trim() || `it exited ${ran.status}`}`);
  return `${from}\n${ran.text}`;
});

export const carryRipgrep: (tools: Tools) => ToolCarried = Effect.fn('release.ripgrep')(function* ({ packages, root, platform, carried }) {
  const files = yield* FileSystem.FileSystem;
  const ripgrep = yield* resolved('ripgrep', '@vscode/ripgrep/package.json', `${packages}/ripgrep`);
  const from = `${yield* carried(dirname(ripgrep), `@vscode/ripgrep-${platform}`)}/bin/rg`;
  yield* files.makeDirectory(dirname(`${root}/${RIPGREP_PART}`), { recursive: true });
  yield* files.writeFile(`${root}/${RIPGREP_PART}`, yield* files.readFile(from), { mode: 0o700 });
  return yield* runs('ripgrep', `${root}/${RIPGREP_PART}`, root, from);
});

export const carryTypescript: (tools: Tools) => ToolCarried = Effect.fn('release.typescript')(function* ({
  packages,
  root,
  platform,
  carried,
}) {
  const files = yield* FileSystem.FileSystem;
  const typescript = yield* resolved('TypeScript 7', 'typescript7/package.json', `${packages}/navigation-ts`);
  const from = yield* carried(dirname(typescript), `@typescript/typescript-${platform}`);
  yield* files.copy(`${from}/lib`, `${root}/${TYPESCRIPT_PART}`);
  return yield* runs('TypeScript 7 compiler', `${root}/${TYPESCRIPT_COMPILER}`, root, from);
});

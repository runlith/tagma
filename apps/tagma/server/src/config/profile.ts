import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_SOURCES } from '@runlith/tagma/sources';
import { Effect, FileSystem } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { Door } from './protocol.js';

export const EVALUATOR = fileURLToPath(new URL('./evaluate.ts', import.meta.url));

const SOURCES = fileURLToPath(new URL('./sources.ts', import.meta.url));

export type Profile = { readonly doors: Readonly<Record<string, Door>>; readonly revision: string };

const unrunnable = (path: string, why: string) =>
  new GateRefusal(
    'config-unrunnable',
    `Tagma cannot evaluate tagma.config.ts: ${path}, a file of this Tagma build, could not be read: ${why}`,
    ['this Tagma installation is incomplete: install it again and restart Tagma on it'],
  );

const textAt = (files: FileSystem.FileSystem, path: string) =>
  files.readFileString(path).pipe(Effect.mapError((failure) => unrunnable(path, failure.message)));

export const evaluationProfile = Effect.fn('Configs.profile')(function* () {
  const files = yield* FileSystem.FileSystem;
  const doorPaths = Object.entries(RULE_SOURCES).map(([specifier, url]) => [specifier, fileURLToPath(url)] as const);
  const [evaluator, sources, ...texts] = yield* Effect.all([
    textAt(files, EVALUATOR),
    textAt(files, SOURCES),
    ...doorPaths.map(([, path]) => textAt(files, path)),
  ]);
  const doors: Record<string, Door> = Object.fromEntries(
    doorPaths.map(([specifier, path], at) => [specifier, { file: basename(path), text: texts[at]! }]),
  );
  const hash = createHash('sha256').update(`${Bun.version}\0${evaluator}\0${sources}\0`);
  for (const [specifier, door] of Object.entries(doors)) hash.update(`${specifier}\0${door.text}\0`);
  return { doors, revision: hash.digest('hex') } satisfies Profile;
});

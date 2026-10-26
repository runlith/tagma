import { dirname, isAbsolute, join, relative } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { orAbsent } from './namespace';

const ENTRY_CAP = 12;

function firstEntries(entries: readonly string[]): string[] {
  const first: string[] = [];
  for (const entry of entries) {
    let at = 0;
    while (at < first.length && first[at]! < entry) at += 1;
    if (at === ENTRY_CAP) continue;
    first.splice(at, 0, entry);
    if (first.length > ENTRY_CAP) first.pop();
  }
  return first;
}

const ancestorListing = Effect.fn('missingPath.ancestorListing')(function* (target: string, display: (path: string) => string) {
  const fs = yield* FileSystem.FileSystem;
  let directory = dirname(target);
  for (;;) {
    const info = yield* orAbsent(fs.stat(directory));
    if (info?.type === 'Directory') break;
    const parent = dirname(directory);
    if (parent === directory) return 'No existing ancestor directory was found.';
    directory = parent;
  }
  const entries = yield* fs.readDirectory(directory);
  const shown = yield* Effect.forEach(
    firstEntries(entries),
    (entry) => Effect.map(orAbsent(fs.stat(join(directory, entry))), (info) => (info?.type === 'Directory' ? `${entry}/` : entry)),
    { concurrency: ENTRY_CAP },
  );
  const more = entries.length - shown.length;
  return [
    `Nearest existing directory: ${display(directory)}`,
    '<entries>',
    ...shown,
    ...(more > 0 ? [`+${more} more`] : []),
    '</entries>',
  ].join('\n');
});

export const missingPath = Effect.fn('missingPath')(function* (cwd: string, target: string, asked: string | undefined, problem: string) {
  const display = (path: string) => (isAbsolute(asked ?? '.') ? path : relative(cwd, path) || '.');
  const reason = `${problem}: ${display(target)}`;
  const listing = yield* Effect.result(ancestorListing(target, display));
  return `${reason}\n\n${listing._tag === 'Success' ? listing.success : `Ancestor listing unavailable: ${listing.failure.message}`}`;
});

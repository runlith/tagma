import { readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { Effect } from 'effect';
import { isMachO, signCode } from '@runlith/codesign/codesign';

const machOUnder = (directory: string, apart: ReadonlySet<string>): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (apart.has(path)) return [];
    if (entry.isDirectory()) return machOUnder(path, apart);
    return entry.isFile() && isMachO(path) ? [path] : [];
  });

export const sealRelease = Effect.fnUntraced(function* (root: string, identity: string, apart: readonly string[]) {
  const found = yield* Effect.try({
    try: () => machOUnder(root, new Set(apart.map((part) => `${root}/${part}`))),
    catch: (cause) => `${root} could not be walked: ${String(cause)}`,
  });
  for (const code of found) {
    const signed = signCode(code, { identity, timestamp: true });
    if (signed._tag === 'Refused') return yield* Effect.fail(`${relative(root, code)} could not be signed: ${signed.detail}`);
  }
});

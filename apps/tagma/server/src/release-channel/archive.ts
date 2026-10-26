import { Effect } from 'effect';
import { type ArchiveEntry, entryRefusal } from '../installation/contract/wire/archive.js';
import { captured } from './child.js';

const TAR = '/usr/bin/tar';
export const UNPACK_FLAGS = ['--no-xattrs', '--no-mac-metadata', '--no-acls', '--no-fflags', '--no-same-owner'] as const;
const KINDS: Readonly<Record<string, ArchiveEntry['kind']>> = { '-': 'file', d: 'directory', l: 'link', h: 'hard link' };

const targetOf = (line: string, name: string): string | null => {
  const named = line.indexOf(name);
  const arrow = line.indexOf(' -> ', named < 0 ? 0 : named + name.length);
  return arrow < 0 ? null : line.slice(arrow + ' -> '.length);
};

export const listingRefusal = (names: readonly string[], verbose: readonly string[]): string | null => {
  if (names.length !== verbose.length) return 'a name in the archive carries a line break';
  for (const [at, name] of names.entries()) {
    const line = verbose[at]!;
    const kind = KINDS[line.charAt(0)] ?? 'other';
    const refused = entryRefusal({ name, kind, target: kind === 'link' ? targetOf(line, name) : null });
    if (refused !== null) return refused;
  }
  return null;
};

const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

export const archiveRefusal = Effect.fn('release.inspectArchive')(function* (file: string, env: NodeJS.ProcessEnv) {
  const names = yield* captured([TAR, '-tzf', file], env);
  if (names.code !== 0) return `the archive does not list: ${names.err.trim()}`;
  const verbose = yield* captured([TAR, '-tzvf', file], env);
  if (verbose.code !== 0) return `the archive does not list: ${verbose.err.trim()}`;
  return listingRefusal(lines(names.out), lines(verbose.out));
});

export const unpackCommand = (file: string, into: string): readonly string[] => [TAR, '-xzf', file, '-C', into, ...UNPACK_FLAGS];

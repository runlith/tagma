import { Effect } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { EXECUTIONS_RUNTIME } from '../installation/contract/wire/archive.js';
import { output } from '../cut/command.js';

const PACK_FLAGS = ['--no-xattrs', '--no-mac-metadata', '--no-acls', '--no-fflags', '--uid', '0', '--gid', '0', '--numeric-owner'];

export const packRelease = (
  root: string,
  archive: string,
  entry = '.',
): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner> =>
  output('/usr/bin/tar', [...PACK_FLAGS, '--exclude', `./${EXECUTIONS_RUNTIME}`, '-czf', archive, '-C', root, entry], root, {
    COPYFILE_DISABLE: '1',
  }).pipe(
    Effect.mapError((failure) => failure.detail),
    Effect.flatMap((ran) => (ran.status === 0 ? Effect.void : Effect.fail(`tar exited ${ran.status}: ${ran.text.trim()}`))),
  );

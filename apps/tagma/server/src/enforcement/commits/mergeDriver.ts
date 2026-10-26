import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import type { HookCli } from './hooks.js';
import { gateStanding, type GateStanding, MARK, OWNER_LINE } from '../contract/wire/gateHook.js';

export const MERGE_DRIVER = 'tagma-graph';

const ATTRIBUTE = `/${CHECKOUT_DIRECTORY}/**/*.md merge=${MERGE_DRIVER}`;

const SCRIPT = join('tagma', 'merge-driver');

const quoted = (value: string): string => `'${value.split("'").join(`'\\''`)}'`;

export const driverText = (cli: HookCli): string =>
  [
    '#!/bin/sh',
    MARK,
    `${OWNER_LINE}${cli.owner}`,
    `runtime=${quoted(cli.runtime)}`,
    `entry=${quoted(cli.entry)}`,
    'if [ -x "$runtime" ] && [ -f "$entry" ]; then',
    '  "$runtime" "$entry" merge-driver "$@"',
    'else',
    '  git merge-file --marker-size="$4" -L "$5 (ours)" -L base -L "$5 (theirs)" "$2" "$1" "$3"',
    'fi',
    'status=$?',
    'kill -0 "$PPID" 2>/dev/null || rm -f "$1" "$2" "$3"',
    'exit "$status"',
    '',
  ].join('\n');

const configured = (git: Git['Service'], root: string, args: readonly string[]) =>
  Effect.flatMap(git.run(['-C', root, 'config', '--local', ...args]), (answer) =>
    answer.status === 0 || answer.status === 5
      ? Effect.void
      : Effect.fail(new Error(answer.stderr.trim() || `git config ${args.join(' ')} ended ${answer.status}`)),
  );

const settled = (git: Git['Service'], root: string, key: string, value: string) =>
  Effect.flatMap(git.run(['-C', root, 'config', '--local', '--get', key]), (answer) =>
    answer.status === 0 && answer.stdout.replace(/\n$/u, '') === value ? Effect.void : configured(git, root, [key, value]),
  );

const attributesAt = (common: string): string => join(common, 'info', 'attributes');

const textOf = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw failure;
  }
};

const linesOf = (path: string): string[] =>
  textOf(path)
    .split('\n')
    .filter((line) => line !== '');

export const driverStanding = (common: string, owner: string): GateStanding =>
  gateStanding(textOf(join(common, SCRIPT)), owner, existsSync);

export const registerMergeDriver = Effect.fnUntraced(function* (
  git: Git['Service'],
  root: string,
  common: string,
  cli: HookCli,
  gate?: GateStanding,
) {
  const script = join(common, SCRIPT);
  const ours = yield* Effect.try(() => {
    const previous = textOf(script);
    const standing = gate ?? gateStanding(previous, cli.owner, existsSync);
    if (standing === 'foreign') return false;
    mkdirSync(dirname(script), { recursive: true });
    const next = driverText(cli);
    if (previous !== next) writeFileSync(script, next, { mode: 0o755 });
    chmodSync(script, 0o755);
    const attributes = attributesAt(common);
    const lines = linesOf(attributes);
    if (!lines.includes(ATTRIBUTE)) {
      mkdirSync(dirname(attributes), { recursive: true });
      writeFileSync(attributes, `${[...lines, ATTRIBUTE].join('\n')}\n`);
    }
    return true;
  });
  if (!ours) return;
  yield* settled(git, root, `merge.${MERGE_DRIVER}.name`, 'Tagma graph files: debt both sides lowered takes the lowest');
  yield* settled(git, root, `merge.${MERGE_DRIVER}.driver`, `${quoted(script)} %O %A %B %L %P`);
});

export const unregisterMergeDriver = Effect.fnUntraced(function* (
  git: Git['Service'],
  root: string,
  common: string,
  owner: string,
  gate?: GateStanding,
) {
  const ours = yield* Effect.try(() => {
    const script = join(common, SCRIPT);
    const standing = gate ?? gateStanding(textOf(script), owner, existsSync);
    if (standing === 'foreign' || standing === 'not-ours') return false;
    rmSync(script, { force: true });
    const attributes = attributesAt(common);
    const lines = linesOf(attributes);
    if (lines.includes(ATTRIBUTE))
      writeFileSync(
        attributes,
        lines
          .filter((line) => line !== ATTRIBUTE)
          .map((line) => `${line}\n`)
          .join(''),
      );
    return true;
  });
  if (!ours) return;
  yield* configured(git, root, ['--unset', `merge.${MERGE_DRIVER}.name`]);
  yield* configured(git, root, ['--unset', `merge.${MERGE_DRIVER}.driver`]);
});

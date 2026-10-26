import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { Argument, Command } from 'effect/cli';
import { CurrentInvocation, end } from '../../platform/cli/verb.js';
import { debtReconciled } from '../commits/graphMerge.js';

export const mergeDriver = Command.make(
  'merge-driver',
  {
    base: Argument.String('base'),
    ours: Argument.String('ours'),
    theirs: Argument.String('theirs'),
    marker: Argument.String('marker-size'),
    path: Argument.String('path'),
  },
  (args) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const [base, ours, theirs] = [args.base, args.ours, args.theirs].map((one) => resolve(at.cwd, one)) as [string, string, string];
      const sides = yield* debtReconciled({
        base: readFileSync(base, 'utf8'),
        ours: readFileSync(ours, 'utf8'),
        theirs: readFileSync(theirs, 'utf8'),
      });
      writeFileSync(base, sides.base);
      writeFileSync(ours, sides.ours);
      writeFileSync(theirs, sides.theirs);
      const merged = spawnSync(
        'git',
        [
          'merge-file',
          `--marker-size=${args.marker}`,
          '-L',
          `${args.path} (ours)`,
          '-L',
          'base',
          '-L',
          `${args.path} (theirs)`,
          ours,
          base,
          theirs,
        ],
        {
          cwd: at.cwd,
          stdio: 'inherit',
        },
      );
      const code = merged.status ?? 1;
      if (code !== 0) end(code > 0 ? 1 : 2);
    }),
).pipe(
  Command.withDescription(
    'the git merge driver Tagma registers for graph files: debt each side only lowered or retired takes the lowest, the rest merges line by line; exit 0 clean, 1 conflicted',
  ),
);

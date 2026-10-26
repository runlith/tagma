import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import { Reveal } from '../contract/service/reveal.js';
import type { Targets } from '../tree/target.js';

export type Launch = (program: string, args: readonly string[]) => Effect.Effect<number, string>;

type Command = { readonly program: string; readonly args: readonly string[]; readonly checked: boolean };

export function commandFor(platform: NodeJS.Platform, abs: string, directory: boolean): Command {
  if (platform === 'darwin') return { program: 'open', args: ['-R', abs], checked: true };
  if (platform === 'win32') return { program: 'explorer.exe', args: [`/select,${abs}`], checked: false };
  return { program: 'xdg-open', args: [directory ? abs : dirname(abs)], checked: true };
}

export const launching =
  (spawner: ChildProcessSpawner.ChildProcessSpawner['Service']): Launch =>
  (program, args) =>
    Effect.scoped(
      Effect.flatMap(
        ChildProcess.make(program, [...args], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
        (handle) => handle.exitCode,
      ),
    ).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.mapError((failure) => `${program} could not be run: ${failure.reason._tag}`),
    );

export const makeRevealInFiles = (input: { readonly targets: Targets; readonly launch: Launch; readonly platform?: NodeJS.Platform }) => {
  const platform = input.platform ?? process.platform;

  const showAt = Effect.fnUntraced(function* (path: string, abs: string) {
    const stood = yield* Effect.promise(() => stat(abs).catch(() => null));
    if (stood === null) return yield* new GateRefusal('files', `${path} does not exist`, ['pick an entry the tree lists']);
    const command = commandFor(platform, abs, stood.isDirectory());
    const exit = yield* Effect.mapError(
      input.launch(command.program, command.args),
      (reason) => new GateRefusal('files', reason, ['open the file manager yourself']),
    );
    if (command.checked && exit !== 0) {
      return yield* new GateRefusal('files', `${command.program} refused ${path} (exit ${exit})`, ['open the file manager yourself']);
    }
  });

  return Reveal.of({
    show: Effect.fnUntraced(function* (place, path) {
      const target = yield* input.targets.of(place, path, 'entry');
      yield* showAt(path, target.abs);
    }),
    showLoose: Effect.fnUntraced(function* (path) {
      if (!isAbsolute(path)) {
        return yield* new GateRefusal('path-outside-tree', `${path} is relative: name it by its absolute path`, [
          'name a path relative to the checkout root, or an absolute path with no root',
        ]);
      }
      yield* showAt(path, resolve(path));
    }),
  });
};

import { join } from 'node:path';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { CommitShape } from '../../change-record/contract/service/shape.js';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { config } from '../../config/config.js';
import { ProgramRoad, type ProgramEnding, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import { GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { makeCommitShape } from '../../commit-steps/shape.js';
import { localRoad } from '../../executions/testing/road.js';
import { makeCommitTrees } from './landingServices.js';

export const FORMATTER = `#!/bin/sh
for file in "$@"; do
  sed 's/[[:space:]]*$//' "$file" > "$file.next" && mv "$file.next" "$file"
  echo "wrote beside" > "$file.beside"
done
`;

export const HEADING = `#!/bin/sh
for file in "$@"; do
  { echo "// header"; cat "$file"; } > "$file.next" && mv "$file.next" "$file"
done
`;

export const FAILING = `#!/bin/sh
echo "cannot parse $1: unexpected token" >&2
exit 2
`;

export const SLEEPING = `#!/bin/sh
exec sleep 20
`;

export const STRAY = `#!/bin/sh
echo "// stray" >> src/b.ts
for file in "$@"; do
  sed 's/[[:space:]]*$//' "$file" > "$file.next" && mv "$file.next" "$file"
done
`;

export const EXECUTABLE = `#!/bin/sh
chmod +x "$@"
`;

export type Stepped = { readonly shape: CommitShape['Service']; readonly launches: ProgramLaunch[] };

export type RoadOptions = { readonly timeMs?: number; readonly keyed?: { readonly afterFirst: () => Effect.Effect<void, unknown> } };

export const steppedOver = Effect.fnUntraced(function* (store: MachineStore['Service'], options: RoadOptions = {}) {
  const launches: ProgramLaunch[] = [];
  const local = localRoad(launches, { timeMs: options.timeMs });
  const keyed = options.keyed;
  const answers = new Map<string, ProgramEnding>();
  const road: ProgramRoad['Service'] =
    keyed === undefined
      ? local
      : {
          run: (launch) => {
            const known = answers.get(launch.operation);
            if (known !== undefined) return Effect.succeed(known);
            return Effect.flatMap(local.run(launch), (ending) => {
              answers.set(launch.operation, ending);
              return answers.size === 1 ? Effect.as(Effect.orDie(Effect.suspend(keyed.afterFirst)), ending) : Effect.succeed(ending);
            });
          },
        };
  const configs = yield* Layer.build(config.lifetimes.serving.pipe(Layer.provide(Layer.succeed(ProgramRoad, localRoad([])))));
  const doors = Context.make(CommitTrees, yield* makeCommitTrees).pipe(
    Context.add(ProgramRoad, road),
    Context.add(GraphDirectory, '.tagma'),
    Context.merge(configs),
  );
  return { shape: yield* Effect.provide(makeCommitShape, doors), launches };
});

export const tool = Effect.fn('stepsFixture.tool')(function* (root: string, name: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(join(root, 'tools'), { recursive: true });
  yield* files.writeFileString(join(root, 'tools', name), text);
  yield* files.chmod(join(root, 'tools', name), 0o755);
});

export const declaration = (root: string, steps: readonly object[]) =>
  FileSystem.FileSystem.use((files) =>
    files.writeFileString(
      join(root, 'tagma.config.ts'),
      `export default ${JSON.stringify({ format: Object.fromEntries(steps.map((step, at) => [`step-${at + 1}`, step])) }, null, 2)};\n`,
    ),
  );

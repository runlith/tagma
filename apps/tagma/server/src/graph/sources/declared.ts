import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import { CurrentGraph } from '../contract/service/serving.js';
import { askOnce } from '../tree/oneShot.js';
import type { Declared, DeclaredAnswer, DeclaredJob } from './declaredNames.js';
import { sourceName } from './readers/place.js';

const declaredOf = (job: DeclaredJob): Effect.Effect<Declared> =>
  askOnce<DeclaredAnswer, Error>(new URL('./declaredNames.worker.ts', import.meta.url), job, (message) => new Error(message)).pipe(
    Effect.flatMap((answer) => (answer.state === 'judged' ? Effect.succeed(answer.declared) : Effect.fail(new Error(answer.message)))),
    Effect.orDie,
  );

export const assertDeclared = Effect.fn('Sources.assertDeclared')(function* (
  projects: Projects['Service'],
  projectId: number,
  ref: string,
  symbol: string,
): Effect.fn.Return<void, StoreFailure | GateRefusal<'symbol-missing' | 'not-found'>> {
  const project = yield* projects.byId(projectId);
  if (project.kind === 'global') return;
  const served = yield* CurrentGraph;
  const root = served !== null && served.projectId === projectId ? served.checkout : project.rootPath;
  const head = symbol.split('.')[0] as string;
  const declared = yield* declaredOf({ root, ref, head });
  const name = sourceName(ref, symbol);
  if (declared.state === 'absent') {
    return yield* new GateRefusal('symbol-missing', `${name} names a symbol of "${ref}", but no such file stands in ${root}`, [
      `name the path of the file that declares ${symbol}`,
      `anchor "${ref}" as a file source while the code that declares ${symbol} is not written`,
    ]);
  }
  if (declared.state !== 'undeclared') return;
  return yield* new GateRefusal('symbol-missing', `"${ref}" declares no "${head}" at its top level, so ${name} names nothing`, [
    declared.nearest.length === 0
      ? `"${ref}" declares nothing: anchor it as a file source`
      : `name a symbol it declares — nearest: ${declared.nearest.join(', ')}`,
    `name a member or a nested function through its top-level owner: Owner.${head}`,
    `anchor "${ref}" as a file source while the code that declares ${head} is not written`,
  ]);
});

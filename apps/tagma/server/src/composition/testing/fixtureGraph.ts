import { Effect, Layer } from 'effect';
import { graphLayer } from '../../graph/layer.js';
import { GraphSource } from '../../graph/contract/service/source.js';
import { graphStepsLayer } from '../../graph/steps/sequence.js';
import { holderCopiesLayer, holderStandingsLayer } from '../../graph/work/tasks/holders.js';
import { Catalogs, NO_CATALOGS } from '../../graph/contract/wire/catalogs.js';
import { Behaviours } from '../../graph/contract/service/behaviours.js';
import { DeclaredSettings } from '../../settings/contract/service/declarations.js';
import { Background } from '../../platform/contract/service/background.js';
import { makeBackground } from '../../platform/background.js';

const declarations = Layer.effect(
  DeclaredSettings,
  Effect.promise(() => import('./settings.js')).pipe(Effect.map(({ SETTING_DECLARATIONS }) => SETTING_DECLARATIONS)),
);

export const fixtureGraph = (options: {
  readonly sourcePath: string;
  readonly originPath?: string;
  readonly catalogs?: Catalogs['Service'];
}) =>
  Layer.orDie(graphLayer({})).pipe(
    Layer.provide(declarations),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Catalogs, options.catalogs ?? NO_CATALOGS),
        Layer.effect(
          Behaviours,
          Effect.promise(() => import('../manifest.js')).pipe(Effect.map(({ BEHAVIOUR_REGISTRY }) => BEHAVIOUR_REGISTRY)),
        ),
        Layer.succeed(GraphSource, {
          sourcePath: options.sourcePath,
          originPath: options.originPath,
        }),
      ),
    ),
    Layer.provideMerge(graphStepsLayer),
    Layer.provideMerge(holderStandingsLayer),
    Layer.provideMerge(holderCopiesLayer),
    Layer.provideMerge(Layer.effect(Background, makeBackground)),
  );

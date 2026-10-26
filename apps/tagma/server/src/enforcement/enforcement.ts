import { enforcement as declaration } from './contract/wire/module.js';
import { Layer } from 'effect';
import { enforcementVerbs } from './cli.js';
import { BEHAVIOURS } from '../graph/contract/service/behaviours.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { lawBehaviours } from './contract/service/lawBehaviours.js';
import { ruleEscapedForm } from './steps/escapedSignal.js';

export const enforcement = manifest({
  ...declaration,
  verbs: enforcementVerbs,
  formSteps: [ruleEscapedForm],
  bodies: async () => Object.values((await import('./operationBodies.js')).ENFORCEMENT_PAIRS),
  tables: async () => {
    const stored = await import('./store/tables.js');
    return { entities: [], history: [stored.remeasureLanding, stored.ruleRefusal] };
  },
  contributions: BEHAVIOURS.of(...lawBehaviours),
  drivers: [{ id: 'remeasure' }, { id: 'commit-hooks' }],
  lifetimes: {
    installation: Layer.mergeAll(
      lazyLayer(
        () => import('./workers/inspectionLanes.js'),
        ({ inspectionsLayer }) => inspectionsLayer,
      ),
      lazyLayer(
        () => import('./judging/judge.js'),
        ({ ruleJudgementLayer }) => ruleJudgementLayer,
      ),
    ),
    serving: lazyLayer(
      () => import('./serving.js'),
      ({ enforcementServingLayer }) => enforcementServingLayer,
    ),
  },
});

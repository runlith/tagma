import { externalHarnesses as declaration } from './contract/wire/module.js';
import { Layer } from 'effect';
import { externalHarnessVerbs } from './cli.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { ExternalRolloutPart } from '../threads/contract/service/parts.js';
import { EXTERNAL_HARNESS_SETTING_KEYS } from './settings.js';
import { teamLaw } from './installs/teamLaw.js';
import { guidanceForm } from './steps/placeGuidance.js';
import { weaknessesForm } from './steps/transportWeaknesses.js';
import { hostedSelectionForm } from './steps/hostedSelection.js';
import { claudeCodeHarnessForm } from './steps/claudeCodeHarness.js';
import { sessionMetaForm } from './steps/sessionMeta.js';
import { terminalSteerForm } from './steps/terminalSteer.js';
import { terminalHistoryForm } from './steps/terminalHistory.js';
import { terminalContinueForm } from './steps/terminalContinue.js';

export const externalHarnesses = manifest({
  ...declaration,
  tables: async () => {
    const [{ externalSession }, { protocolSession }, { vendorTurn, vendorSession }, { installRefresh }] = await Promise.all([
      import('../threads/store/harnessFacet.js'),
      import('./store/protocol.js'),
      import('./store/turns.js'),
      import('./store/installs.js'),
    ]);
    return { entities: [externalSession, protocolSession, vendorSession, installRefresh], history: [vendorTurn] };
  },
  verbs: externalHarnessVerbs,
  formSteps: [
    guidanceForm,
    weaknessesForm,
    hostedSelectionForm,
    claudeCodeHarnessForm,
    sessionMetaForm,
    terminalSteerForm,
    terminalHistoryForm,
    terminalContinueForm,
  ],
  bodies: async () => {
    const [{ HOOK_PAIRS }, { HOSTED_PAIRS }, { HARNESS_PAIRS }, { installationStatusRead }] = await Promise.all([
      import('./hookOperations.js'),
      import('./hostedOperations.js'),
      import('./operations.js'),
      import('./installs/statusOperation.js'),
    ]);
    return [...HOOK_PAIRS, ...HOSTED_PAIRS, ...HARNESS_PAIRS, installationStatusRead];
  },
  presentation: async () => (await import('./operations.js')).HARNESS_PRESENTATION,
  settings: [...EXTERNAL_HARNESS_SETTING_KEYS],
  sections: [
    {
      id: 'thread-teams',
      place: { law: 30 },
      owner: 'external-harnesses',
      render: teamLaw,
      path: 'src/external-harnesses/installs/teamLaw.ts',
    },
  ],
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./sessions/sessionRead.js'), import('./rollout.js')]),
      ([{ sessionReadLayer }, { externalRolloutPart }]) =>
        Layer.mergeAll(sessionReadLayer, Layer.succeed(ExternalRolloutPart, externalRolloutPart)),
    ),
    workspace: lazyLayer(
      () => import('./assembly.js'),
      ({ externalHarnessesLayer }) => externalHarnessesLayer,
    ),
    serving: lazyLayer(
      () => import('./serving.js'),
      ({ externalServingLayer }) => externalServingLayer,
    ),
  },
});

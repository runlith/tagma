import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { commitStepsSection } from './doctrine.js';

export const commitSteps = manifest({
  id: 'commit-steps',
  title: 'The commands that shape and derive the tree of a commit',
  operations: async () => ({
    declarations: {},
    refusals: {
      'derive-missing': 'Derivation program not found',
      'derive-failed': 'Derivation failed',
      'derive-cut': 'Derivation ran too long',
    },
  }),
  sections: [
    {
      id: 'commit-steps',
      place: { prompt: 100 },
      owner: 'commit-steps',
      render: commitStepsSection,
      path: 'src/commit-steps/doctrine.ts',
      fact: 'config',
    },
  ],
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ commitShapeLayer }) => commitShapeLayer,
    ),
  },
});

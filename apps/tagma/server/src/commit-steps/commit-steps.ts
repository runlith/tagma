import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { commitStepsSection } from './doctrine.js';

export const commitSteps = manifest({
  id: 'commit-steps',
  title: 'The format commands a repository declares to shape every commit Tagma lands',
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

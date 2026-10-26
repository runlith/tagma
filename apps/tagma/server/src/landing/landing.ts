import { landing as declaration } from './contract/wire/module.js';
import { Context, Effect } from 'effect';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { LandingGit } from './contract/service/servedGit.js';
import { commits } from './doctrine/commits.js';

export const landing = manifest({
  ...declaration,
  contributions: RELOCATIONS.of({ id: 'landing/open', tables: ['landing_intent', 'merge_request'], relocate: () => Effect.succeed([]) }),
  presentation: async () => (await import('./presentation.js')).LANDING_PRESENTATION,
  bodies: async () => {
    const [{ SUBMIT_PAIRS }, { MERGE_PAIRS }, { CHECKOUT_COMMIT_PAIRS }] = await Promise.all([
      import('./operations/submit.js'),
      import('./operations/merge.js'),
      import('./operations/checkouts.js'),
    ]);
    return [...Object.values(SUBMIT_PAIRS), ...Object.values(MERGE_PAIRS), ...Object.values(CHECKOUT_COMMIT_PAIRS)];
  },
  tables: async () => {
    const [{ landingIntent, landingReceipt, submitReceipt, mergeReceipt, mergeRequest, worktreePendingMerge }] = await Promise.all([
      import('./store/tables.js'),
    ]);
    return { entities: [worktreePendingMerge], history: [landingIntent, landingReceipt, submitReceipt, mergeReceipt, mergeRequest] };
  },
  sections: [
    {
      id: 'commits',
      place: { prompt: 90, law: 70 },
      owner: 'landing',
      render: commits,
      path: 'src/landing/doctrine/commits.ts',
    },
  ],
  lifetimes: {
    installation: lazyLayer(
      () => import('./lifetime.js'),
      ({ landingLayer }) => landingLayer,
    ),
    serving: lazyLayer(
      () => import('./serving.js'),
      ({ landingServingLayer }) => landingServingLayer,
    ),
    call: (input: { readonly servingGit: LandingGit['Service']['run'] }) => Context.make(LandingGit, { run: input.servingGit }),
  },
});

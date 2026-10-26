import { workspace as declaration } from './contract/wire/module.js';
import { Context, Layer } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { CHECKOUT_FEED } from './contract/wire/checkout.js';
import { CheckoutPlaces, CheckoutRows, CheckoutWrites } from './contract/service/checkouts.js';
import type { CheckoutLive } from './contract/service/live.js';
import { CHECKOUT_SETTING_KEYS, CHECKOUT_SETTING_SECTIONS } from './contract/wire/settings.js';

const FEEDS = [CHECKOUT_FEED] as const;

const live: CheckoutLive = liveOf(FEEDS, async (door) =>
  (await import('./checkouts/feed.js')).checkoutChannel(Context.get(door, CheckoutPlaces), Context.get(door, CheckoutRows)),
);

export const workspace = manifest({
  ...declaration,
  bodies: async () => {
    const [{ CHECKOUT_PAIRS }, { REPOSITORY_PAIRS }] = await Promise.all([
      import('./operations/checkouts.js'),
      import('./operations/reads.js'),
    ]);
    return [...Object.values(CHECKOUT_PAIRS), ...Object.values(REPOSITORY_PAIRS)];
  },
  subjects: async () => (await import('./subjects.js')).WORKSPACE_SUBJECTS,
  live,
  settings: [...CHECKOUT_SETTING_KEYS],
  settingSections: [...CHECKOUT_SETTING_SECTIONS],
  tables: async () => {
    const [
      {
        assignmentMembership,
        assignmentSelection,
        environment,
        environmentUse,
        fileRootNamespace,
        fileRoot,
        projectRoot,
        projectRootCover,
        repository,
        rootUse,
        rootUseHold,
      },
    ] = await Promise.all([import('./store/tables.js')]);
    return {
      entities: [
        assignmentMembership,
        assignmentSelection,
        environment,
        fileRootNamespace,
        fileRoot,
        projectRoot,
        projectRootCover,
        repository,
        rootUse,
        rootUseHold,
      ],
      history: [environmentUse],
    };
  },
  drivers: [{ id: 'root-healing' }, { id: 'commit-trees-sweep' }],
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./layer.js'), import('./checkouts/fastStatus.js')]),
      ([{ workspaceLayer, commitTreesLayer }, { fastStatusLayer }]) => Layer.mergeAll(workspaceLayer, fastStatusLayer, commitTreesLayer),
    ),
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ checkoutWritesLayer }) => checkoutWritesLayer,
    ),
    call: (input: { readonly checkoutActs: CheckoutWrites['Service'] }) => Context.make(CheckoutWrites, input.checkoutActs),
  },
});

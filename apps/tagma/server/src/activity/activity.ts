import { ActivityFaults } from '@runlith/activity/store/faults';
import { Context } from 'effect';
import { lazyLayer, type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { ACTIVITY_FEEDS, type FAULTS_FEED } from './contract/wire/faults.js';
import { activity as declaration } from './contract/wire/module.js';
import { ACTIVITY_SETTING_KEYS, ACTIVITY_SETTING_SECTIONS } from './contract/wire/settings.js';

const live: LiveDeclaration<typeof ACTIVITY_FEEDS, ActivityFaults> = liveOf(ACTIVITY_FEEDS, async (door) => {
  const { faultsFeed } = await import('./faults.js');
  return { 'faults.subscribe': ({ limit }: typeof FAULTS_FEED.input.Type) => faultsFeed(Context.get(door, ActivityFaults), limit) };
});

export const activity = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).ACTIVITY_PAIRS),
  live,
  settings: [...ACTIVITY_SETTING_KEYS],
  settingSections: ACTIVITY_SETTING_SECTIONS,
  lifetimes: {
    preparation: lazyLayer(
      () => import('@runlith/activity/store'),
      ({ activityPreparationLayer }) => activityPreparationLayer,
    ),
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ activityLayer }) => activityLayer,
    ),
  },
});

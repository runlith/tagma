import { Context } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { AWAKE_FEED, PACE_FEED } from './contract/wire/power.js';
import { AwakePolicy } from './contract/service/awake.js';
import { AgentPace } from './contract/service/pace.js';
import type { PowerLive } from './contract/service/live.js';
import { POWER_SETTING_SECTIONS, agentWork, keepAwake } from './keys.js';

const FEEDS = [AWAKE_FEED, PACE_FEED] as const;

const live: PowerLive = liveOf(FEEDS, (door) => ({
  'awake.subscribe': () => Context.get(door, AwakePolicy).changes,
  'pace.subscribe': () => Context.get(door, AgentPace).changes,
}));

export const power = manifest({
  id: 'power',
  settings: [keepAwake, agentWork],
  settingSections: POWER_SETTING_SECTIONS,
  live,
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./awake.js'), import('./sleepAssertion.js')]),
      ([{ awakePolicyLayer }, { idleSleepFacility }]) => awakePolicyLayer(idleSleepFacility(process.platform, process.pid)),
    ),
  },
});

import type { Composition } from '../../installation/cut/release.js';
import { applications } from '../../mac-applications/placement.js';
import { BINDINGS } from './bindings.js';
import { CHANNEL } from './channel.js';

export const CUT: Composition = {
  conditions: ['release'],
  developer: BINDINGS.hostModules.developer !== null,
  channel: CHANNEL,
  applications,
};

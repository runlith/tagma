import type { Composition } from '../../installation/cut/release.js';
import { applications } from '../../mac-applications/placement.js';
import { CHANNEL } from './channel.js';

export const CUT: Composition = {
  conditions: [],
  channel: CHANNEL,
  applications,
};

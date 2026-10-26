import { recordedHolder, type RecordedTaken, takeRecorded } from '../../platform/lock/recorded.js';
import type { Channel } from '../contract/wire/channel.js';
import {
  ACTIVE_FILE,
  ACTIVE_LOCK,
  type ActiveHolder,
  type ActiveServer,
  junctionDirectory,
  readActive,
} from '../contract/wire/junction.js';

export const takeActive = (junction: string, own: ActiveServer): RecordedTaken<ActiveServer> =>
  takeRecorded(`${junction}/${ACTIVE_LOCK}`, `${junction}/${ACTIVE_FILE}`, own, () => readActive(junction));

export const activeHolder = (junction: string): ActiveHolder | null =>
  recordedHolder(`${junction}/${ACTIVE_LOCK}`, () => readActive(junction));

export const activeElsewhere = (channel: Channel, env: NodeJS.ProcessEnv): ActiveHolder | null => {
  const junction = junctionDirectory(env);
  const holder = junction === null ? null : activeHolder(junction);
  return holder === null || (holder !== 'unnamed' && holder.channel === channel.id) ? null : holder;
};

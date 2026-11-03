import { recordedHolder, type RecordedTaken, takeRecorded } from '../../platform/lock/recorded.js';
import type { Channel } from '../contract/wire/channel.js';
import { Effect } from 'effect';
import { Processes, type ProcessReader } from '@runlith/execution-host/ProcessReader';
import { LockHolders } from '../contract/service/lockHolders.js';
import {
  ACTIVE_FILE,
  ACTIVE_LOCK,
  type ActiveHolder,
  type ActiveServer,
  junctionDirectory,
  readActive,
} from '../contract/wire/junction.js';

export const takeActive = (junction: string, own: ActiveServer): RecordedTaken<ActiveServer> =>
  takeRecorded(`${junction}/${ACTIVE_LOCK}`, `${junction}/${ACTIVE_FILE}`, own, () => readActive(junction), own.chain !== undefined);

export const activeHolder = (junction: string, reader?: ProcessReader): ActiveHolder | null => {
  const holder = recordedHolder(`${junction}/${ACTIVE_LOCK}`, () => readActive(junction));
  if (holder === null || holder === 'unnamed' || holder.birth === undefined || reader === undefined) return holder;
  const current = reader.identity(holder.pid);
  return current._tag === 'Read' && !current.zombie && current.birth === holder.birth ? holder : 'unnamed';
};

export const enteredActive = Effect.fn('installation.enteredActive')(function* (channel: Channel, env: NodeJS.ProcessEnv) {
  const junction = junctionDirectory(env);
  const holder = junction === null ? null : readActive(junction);
  if (junction === null || holder === null || holder.channel !== channel.id) return false;
  if (holder.birth !== undefined) {
    const current = (yield* Processes).identity(holder.pid);
    return current._tag === 'Read' && !current.zombie && current.birth === holder.birth;
  }
  const held = yield* Effect.flatMap(LockHolders, (holders) => holders.of(`${junction}/${ACTIVE_LOCK}`));
  return held._tag === 'Holders' && held.pids.includes(holder.pid);
});

export const activeElsewhere = (channel: Channel, env: NodeJS.ProcessEnv): ActiveHolder | null => {
  const junction = junctionDirectory(env);
  const holder = junction === null ? null : activeHolder(junction);
  return holder === null || (holder !== 'unnamed' && holder.channel === channel.id) ? null : holder;
};

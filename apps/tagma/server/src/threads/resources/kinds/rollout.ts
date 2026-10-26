import { Effect } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { Unit } from '../../../platform/contract/service/units.js';

export type RolloutRelease = {
  release(projectId: number, threadId: string): Effect.Effect<void>;
};

const ROLLOUT_ID = /^(\d+)\/([0-9a-zA-Z-]{1,64})$/;

export function rolloutId(projectId: number, threadId: string): string {
  return `${projectId}/${threadId}`;
}

export function rolloutKind(rollouts: RolloutRelease): ThreadResourceKind<Unit<'machine'>> {
  return {
    kind: 'rollout',
    release: (row) => {
      const named = ROLLOUT_ID.exec(row.id);
      if (!named) {
        return Effect.fail(new ThreadCallBroke({ cause: new Error(`A rollout row names no project and thread: ${row.id}.`) }));
      }
      return rollouts.release(Number(named[1]), named[2] as string);
    },
    describe: (row) => ({
      kind: row.kind,
      id: row.id,
      detail: 'the rollout file this thread`s records are appended to and a boot replays',
      heldAt: row.heldAt.toISOString(),
    }),
  };
}

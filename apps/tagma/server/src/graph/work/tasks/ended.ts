import { Effect, Layer } from 'effect';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { subscribersOf } from '../../../platform/subscribers.js';
import type { BlockEnd } from '../../contract/service/work.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { type WorkEnded, WorkEnds } from '../../contract/service/workEnds.js';
import { blockName } from '../../contract/wire/references.js';
import { WORK } from '../../contract/wire/tags/work.js';

export const makeWorkEnds = () =>
  WorkEnds.of(subscribersOf<WorkEnded>('a work ending subscriber failed', ({ threadId, block }) => ({ threadId, block })));

export const workEndsLayer = Layer.sync(WorkEnds, makeWorkEnds);

export const announceEnd = Effect.fn('WorkEnds.announce')(function* (caller: Caller, ended: BlockEnd, commit: string | null) {
  const { actor } = caller;
  if (actor.kind !== 'thread') return;
  const table = yield* (yield* Tags).of(ended.projectId);
  const word = table.statusOf(ended);
  if (word === null || !table.supports(ended, WORK)) return;
  yield* (yield* WorkEnds).publish({
    threadId: actor.threadId,
    projectId: actor.projectId,
    block: blockName(ended.uuid),
    title: ended.title,
    word,
    commit,
  });
});

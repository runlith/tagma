import { Effect } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import type { ModelCapacity } from '@runlith/llm/models/description';
import type { ThreadCompactionStorage } from '../storage/compaction';
import { HistoryIndex } from './historyIndex';
import { type ThreadPicture, omitThreadMedia, pictureKey } from './media';
import type { ThreadCompactionPolicy } from './policy';
import { type ThreadPictureBudget, pruneIndexed, pruneToolOutputs, threadPruneProtection } from './prune';
import type { ThreadCompactionText } from './text';

export type ThreadPruner = ReturnType<typeof makeThreadPruner>;

export const makeThreadPruner = <TWrite>({
  checkpoints,
  text,
}: {
  readonly checkpoints: ThreadCompactionStorage<TWrite>;
  readonly text: ThreadCompactionText;
}) => {
  const lineages = new WeakMap<Message, HistoryIndex>();
  return {
    index: (history: readonly Message[]): HistoryIndex => {
      const first = history[0];
      if (first === undefined) return HistoryIndex.of(history, text.prunedToolOutput);
      const held = lineages.get(first);
      const index = held === undefined ? HistoryIndex.of(history, text.prunedToolOutput) : held.over(history);
      lineages.set(first, index);
      return index;
    },

    prune: Effect.fnUntraced(function* (
      threadId: string,
      history: HistoryIndex,
      capacity: ModelCapacity,
      policy: ThreadCompactionPolicy,
      pictures?: ThreadPictureBudget,
    ) {
      const decided = yield* checkpoints.prunedToolCalls(threadId);
      const pruned = pruneIndexed(
        history,
        { ...threadPruneProtection(capacity, policy), recentUserTurns: policy.recentUserTurns, pictures },
        decided,
        text.prunedToolOutput,
      );
      const cleared: ReadonlySet<string> =
        pruned.newlyPruned.length > 0 ? new Set([...decided, ...pruned.newlyPruned.map((call) => call.toolCallId)]) : decided;
      const omits = (picture: ThreadPicture): boolean =>
        !picture.tool && picture.location !== null && pruned.prunedMedia.has(pictureKey(picture.index, picture.location));
      const projected =
        pruned.prunedMedia.size === 0
          ? { messages: pruned.messages, omitted: 0 }
          : omitThreadMedia(pruned.messages, omits, text.omittedMedia);
      return {
        messages: projected.messages,
        cleared,
        stored: projected.messages,
        foldsRecord: pruned.prunedResults > 0 || projected.omitted > 0,
        marks: pruned.newlyPruned,
      };
    }),

    bounded: Effect.fnUntraced(function* (
      threadId: string,
      history: readonly Message[],
      capacity: ModelCapacity,
      policy: ThreadCompactionPolicy,
    ) {
      const decided = yield* checkpoints.prunedToolCalls(threadId);
      return pruneToolOutputs(
        history,
        { ...threadPruneProtection(capacity, policy), recentUserTurns: policy.recentUserTurns },
        decided,
        text.prunedToolOutput,
      ).messages;
    }),
  };
};

import { Cause, type Context, Effect } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import type { OrderedCall } from '../../agent/door/CallOrder';
import { toolExecute } from '../../agent/tool';
import { clientToolCalls } from '../../agent/turn/tools';
import { toolSettled, type ThreadToolEntry } from '../../transcript/entries';
import type { Hosted, HostedCall } from './hostedParts';
import type { ThreadChanges } from './ThreadChanges';

export const ANSWERED_OUTSIDE = 'This call was answered before it reached Tagma; it never ran here.';

type EntryOf<F> = (toolCallId: string) => Effect.Effect<ThreadToolEntry | undefined, F>;

const closed = (entry: ThreadToolEntry | undefined): boolean => entry !== undefined && toolSettled(entry.toolState);

const answeredOutside = (entry: ThreadToolEntry | undefined): boolean => closed(entry) && entry?.execution?.state !== 'started';

const sealedCalls = (history: readonly Message[], toolCallId: string) => {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const message = history[at]!;
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    const calls = clientToolCalls(message.content);
    if (calls.some((part) => part.id === toolCallId)) return calls;
  }
  return [];
};

const closing = <F>(
  changes: Context.Service.Shape<typeof ThreadChanges>,
  threadId: string,
  entryOf: EntryOf<F>,
  toolCallId: string,
): Effect.Effect<ThreadToolEntry | undefined, F> =>
  Effect.scoped(
    Effect.flatMap(changes.watch([threadId]), (moved) => {
      const settled: Effect.Effect<ThreadToolEntry | undefined, F> = Effect.suspend(() =>
        Effect.flatMap(entryOf(toolCallId), (entry) => (closed(entry) ? Effect.succeed(entry) : Effect.andThen(moved, settled))),
      );
      return settled;
    }),
  );

export const placeSealed = Effect.fnUntraced(function* <E, F>(
  hosted: Hosted,
  history: Effect.Effect<readonly Message[], E>,
  call: HostedCall,
  changes: Context.Service.Shape<typeof ThreadChanges>,
  entryOf: EntryOf<F>,
): Effect.fn.Return<void, E | F> {
  const { door, catalog } = hosted.handle;
  if (door.order.has(call.toolCallId)) return;
  const calls = sealedCalls(yield* history, call.toolCallId);
  const placing: OrderedCall[] = [];
  for (const part of calls.some((each) => each.id === call.toolCallId)
    ? calls
    : [{ id: call.toolCallId, name: call.name, input: call.input }]) {
    const tool = catalog()[part.name];
    if (tool === undefined || toolExecute(tool) === null || (hosted.active !== null && !hosted.active.has(part.name))) continue;
    if (part.id !== call.toolCallId) {
      const entry = yield* entryOf(part.id);
      if (entry !== undefined && (closed(entry) || entry.execution?.state === 'started')) continue;
    }
    const claims = yield* door
      .claims({ name: part.name, tool, input: part.input, toolCallId: part.id })
      .pipe(Effect.catchTags({ AgentToolFailed: () => Effect.succeed(null), AgentRuleFailed: () => Effect.succeed(null) }));
    if (claims !== null) placing.push({ toolCallId: part.id, name: part.name, claims });
  }
  const fresh = door.order.place(placing);
  for (const toolCallId of fresh) {
    if (toolCallId === call.toolCallId) continue;
    yield* Effect.forkIn(
      closing(changes, call.threadId, entryOf, toolCallId).pipe(
        Effect.flatMap((entry) =>
          Effect.sync(() => answeredOutside(entry) && !hosted.calls.has(toolCallId) && door.decline(toolCallId, ANSWERED_OUTSIDE)),
        ),
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning('an earlier call of a hosted message stopped being watched', { toolCallId, cause: Cause.pretty(cause) }),
        ),
      ),
      hosted.scope,
    );
  }
});

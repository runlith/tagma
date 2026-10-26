import { Deferred, Effect } from 'effect';
import { AgentToolCallRegenerated, AgentToolCallReused, type AgentToolFailure } from '../AgentFailure';
import { type Tool, toolPrepare } from '../tool';
import { DoorMisuse } from './failures';
import type { AgentPermissionQuestion, AgentToolOutcome, AgentToolPreflight, AgentToolResolution } from './types';

type Memo<A> = {
  readonly name: string;
  readonly input: unknown;
  readonly generation: number;
  readonly done: Deferred.Deferred<A, AgentToolFailure>;
};

export type CallLedger = ReturnType<typeof makeCallLedger>;

export const makeCallLedger = ({
  runId,
  generation,
  resolutions: handed,
}: {
  readonly runId: string;
  readonly generation: number;
  readonly resolutions: readonly AgentToolResolution[];
}) => {
  const preflights = new Map<string, Memo<AgentToolPreflight>>();
  const prepared = new Map<string, AgentToolPreflight>();
  const resolutions = new Map<string, AgentToolResolution>();
  const outcomes = new Map<string, Memo<AgentToolOutcome>>();
  const cleanups: Array<() => void> = [];
  let current = generation;
  let active = 0;
  let phase: 'open' | 'closing' | 'ended' = 'open';
  for (const resolution of handed) resolutions.set(resolution.toolCallId, resolution);

  const endIfSettled = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (phase !== 'closing' || active > 0) return Effect.void;
      phase = 'ended';
      preflights.clear();
      prepared.clear();
      outcomes.clear();
      resolutions.clear();
      for (const cleanup of cleanups) cleanup();
      return Effect.void;
    });

  const opened = (toolCallId: string): Effect.Effect<never> | null =>
    phase === 'open'
      ? null
      : Effect.die(new DoorMisuse(`Tool call ${toolCallId} reached the door of run ${runId} after its owner closed it.`));

  const retain = (): void => {
    active += 1;
  };

  const release = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      active -= 1;
      return endIfSettled();
    });

  const hold = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> => {
    retain();
    return Effect.ensuring(work, release());
  };

  const memo = <A>(
    memos: Map<string, Memo<A>>,
    toolCallId: string,
    entry: Omit<Memo<A>, 'done'>,
    settling: Effect.Effect<A, AgentToolFailure>,
  ): Effect.Effect<A, AgentToolFailure> => {
    const pending: Memo<A> = { ...entry, done: Deferred.makeUnsafe<A, AgentToolFailure>() };
    memos.set(toolCallId, pending);
    return hold(settling.pipe(Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(pending.done, exit)))));
  };

  const currentlyPreflighted = (toolCallId: string): boolean => preflights.get(toolCallId)?.generation === current;

  const resolutionFor = (toolCallId: string, name: string, input: unknown): AgentToolResolution | undefined => {
    const held = resolutions.get(toolCallId);
    return held && held.name === name && held.generation === current && Bun.deepEquals(held.input, input) ? held : undefined;
  };

  const receipt = (toolCallId: string, name: string, input: unknown): Effect.Effect<AgentToolOutcome, AgentToolFailure> | null => {
    const held = outcomes.get(toolCallId);
    if (!held) return null;
    if (held.name !== name || !Bun.deepEquals(held.input, input)) {
      return new AgentToolCallReused({ toolCallId, settledAs: held.name, attempted: name });
    }
    return Deferred.await(held.done);
  };

  const held = (toolCallId: string, name: string, input: unknown): Effect.Effect<AgentToolOutcome, AgentToolFailure> | null =>
    receipt(toolCallId, name, input) ?? opened(toolCallId);

  return {
    get generation(): number {
      return current;
    },

    advance: (next: number): void => {
      if (next <= current) {
        throw new DoorMisuse(`Context generation ${next} does not follow ${current} at the door of run ${runId}.`);
      }
      current = next;
    },

    onEnded: (cleanup: () => void): void => {
      cleanups.push(cleanup);
    },

    close: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (phase === 'open') phase = 'closing';
        return endIfSettled();
      }),

    opened,
    retain,
    release,
    hold,

    replayPreflight: (call: AgentPermissionQuestion): Effect.Effect<AgentToolPreflight, AgentToolFailure> | null => {
      const held = preflights.get(call.toolCallId);
      if (!held) return null;
      if (held.generation !== current) {
        return new AgentToolCallRegenerated({
          toolCallId: call.toolCallId,
          admitted: held.generation,
          attempted: current,
        });
      }
      if (held.name !== call.name || !Bun.deepEquals(held.input, call.input)) {
        return new AgentToolCallReused({ toolCallId: call.toolCallId, settledAs: held.name, attempted: call.name });
      }
      return Deferred.await(held.done);
    },

    preflighting: (
      call: AgentPermissionQuestion,
      settling: Effect.Effect<AgentToolPreflight, AgentToolFailure>,
    ): Effect.Effect<AgentToolPreflight, AgentToolFailure> =>
      memo(
        preflights,
        call.toolCallId,
        { name: call.name, input: call.input, generation: current },
        Effect.tap(settling, (ready) => Effect.sync(() => prepared.set(call.toolCallId, ready))),
      ),

    preparedOf: (toolCallId: string): AgentToolPreflight | undefined => prepared.get(toolCallId),

    preflighted: (call: AgentPermissionQuestion): AgentToolPreflight | null => {
      const ready = prepared.get(call.toolCallId);
      if (!ready || ready.name !== call.name || !Bun.deepEquals(ready.rawInput, call.input)) return null;
      return preflights.get(call.toolCallId)?.generation === current ? ready : null;
    },

    currentlyPreflighted,

    resolutionsOf: (toolCallIds: readonly string[]): readonly AgentToolResolution[] => {
      const resolved: AgentToolResolution[] = [];
      for (const toolCallId of toolCallIds) {
        const ready = prepared.get(toolCallId);
        const contributor = ready?.contributor;
        if (!ready || (toolPrepare(ready.tool) === null && ready.reader === undefined && contributor === undefined)) continue;
        resolved.push({
          toolCallId,
          name: ready.name,
          input: ready.rawInput,
          generation: preflights.get(toolCallId)?.generation ?? current,
          preparation: { subjects: ready.subjects, prepared: ready.prepared },
          reader: ready.reader,
          contributor: contributor,
        });
      }
      return resolved;
    },

    resolutionFor,

    resolvable: (tool: Tool, toolCallId: string, name: string, input: unknown): boolean =>
      toolPrepare(tool) === null || currentlyPreflighted(toolCallId) || resolutionFor(toolCallId, name, input) !== undefined,

    receipt,
    held,

    once: (
      toolCallId: string,
      name: string,
      input: unknown,
      settling: () => Effect.Effect<AgentToolOutcome, AgentToolFailure>,
    ): Effect.Effect<AgentToolOutcome, AgentToolFailure> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          const settled = held(toolCallId, name, input);
          if (settled) return restore(settled);
          return memo(outcomes, toolCallId, { name, input, generation: current }, restore(Effect.suspend(settling)));
        }),
      ),
  };
};

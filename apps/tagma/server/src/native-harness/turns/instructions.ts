import type { Message } from '@runlith/llm/schema/messages';
import { agentOriginOf } from '@runlith/agent/AgentSignal';
import { includeInstructions } from '../../graph/orientation/tagPrompts.js';
import { type InstructionSet, instructionSetSchema } from '../../graph/contract/wire/instructions.js';
import type { GraphOrigin } from '../../threads/contract/wire/target.js';
import { toldState } from './guidance.js';
import { Effect, Schema } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { WorkPlaces } from '../../threads/contract/service/working.js';
import type { NativeThreadRows } from '../rows/native.js';

export const instructionsTold = (projectId: number): string => `project-instructions@${projectId}`;

export const homePlace = (ctx: {
  readonly projectId: number;
  readonly graphRoot?: string;
  readonly target: { readonly graph: GraphOrigin };
}): GraphOrigin => ({ projectId: ctx.projectId, root: ctx.graphRoot ?? ctx.target.graph.root });

export function instructionSnapshot(messages: readonly Message[], projectId: number): InstructionSet | undefined {
  return toldState(messages, instructionsTold(projectId), instructionSetSchema);
}

export const informedPlaces = (places: WorkPlaces['Service'], threads: NativeThreadRows): WorkPlaces['Service'] => ({
  ...places,
  enter: Effect.fnUntraced(function* (input) {
    if (!input.mutates || input.home === input.place.projectId) return yield* places.enter({ ...input, law: null });
    const told = yield* threads
      .toldStateOf(input.threadId, instructionsTold(input.place.projectId), input.toolCallId)
      .pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['read the thread again'])));
    const law =
      told === undefined
        ? null
        : yield* Schema.decodeUnknownEffect(instructionSetSchema)(told.value).pipe(
            Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['read the thread again'])),
          );
    return yield* places.enter({ ...input, law });
  }),
});

export const touchedTagsTold = (projectId: number): string => `touch-tags@${projectId}`;

export function instructionTags(messages: readonly Message[], projectId: number): Set<string> {
  const delivered = new Map<string, string>();
  const include = (identities: Iterable<string>) => {
    for (const identity of identities) {
      const key = identity.slice(0, identity.lastIndexOf('@'));
      if (!delivered.has(key)) delivered.set(key, identity);
    }
  };
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at]!;
    if (message.compaction !== undefined) break;
    if (agentOriginOf(message) !== 'guidance' || message.metadata?.runtimeState === undefined) continue;
    const state = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(message.metadata.runtimeState);
    const touched = touchedTagsTold(projectId);
    if (Object.hasOwn(state, touched)) include(Schema.decodeUnknownSync(Schema.Array(Schema.String))(state[touched]));
    const key = instructionsTold(projectId);
    if (Object.hasOwn(state, key)) {
      const snapshot = new Set<string>();
      includeInstructions(snapshot, Schema.decodeUnknownSync(instructionSetSchema)(state[key]));
      include(snapshot);
      break;
    }
  }
  return new Set(delivered.values());
}

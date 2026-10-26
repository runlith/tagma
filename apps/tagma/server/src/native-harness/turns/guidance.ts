import { agentOriginOf } from '@runlith/agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';
import { Schema } from 'effect';

const runtimeState = Schema.Record(Schema.String, Schema.Unknown);

export function toldState<A>(messages: readonly Message[], key: string, schema: Schema.Codec<A, unknown>): A | undefined {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];
    if (message === undefined) continue;
    if (message.compaction !== undefined) return undefined;
    if (agentOriginOf(message) !== 'guidance' || message.metadata?.runtimeState === undefined) continue;
    const state = Schema.decodeUnknownSync(runtimeState)(message.metadata.runtimeState);
    if (Object.hasOwn(state, key)) return Schema.decodeUnknownSync(schema)(state[key]);
  }
  return undefined;
}

import { HashMap, Option, Schema } from 'effect';
import { agentOriginOf } from '@runlith/agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';

export type ToldState = { readonly position: number; readonly value: unknown };
type States = HashMap.HashMap<string, ToldState>;
const runtimeState = Schema.Record(Schema.String, Schema.Unknown);

export class GuidanceIndex {
  constructor(
    readonly position = 0,
    private readonly states: States = HashMap.empty(),
    private readonly calls: HashMap.HashMap<string, States> = HashMap.empty(),
  ) {}

  append(messages: Iterable<Message>): GuidanceIndex {
    let position = this.position;
    let states = this.states;
    let calls = this.calls;
    for (const message of messages) {
      if (message.compaction !== undefined) {
        states = HashMap.empty();
        calls = HashMap.empty();
      }
      if (agentOriginOf(message) === 'guidance' && message.metadata?.runtimeState !== undefined) {
        const told = Schema.decodeUnknownSync(runtimeState)(message.metadata.runtimeState);
        for (const [key, value] of Object.entries(told)) states = HashMap.set(states, key, { position, value });
      }
      if (message.role === 'assistant' && typeof message.content !== 'string') {
        for (const part of message.content) if (part.type === 'tool-call') calls = HashMap.set(calls, part.id, states);
      }
      position += 1;
    }
    return new GuidanceIndex(position, states, calls);
  }

  read(key: string, toolCallId?: string): ToldState | undefined {
    const before = toolCallId === undefined ? this.states : (Option.getOrUndefined(HashMap.get(this.calls, toolCallId)) ?? this.states);
    return Option.getOrUndefined(HashMap.get(before, key));
  }
}

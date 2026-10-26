import { Effect } from 'effect';
import type { Outlet } from '@runlith/acp/agent';
import type { SessionUpdate } from '@runlith/acp/updates';
import type { ToolCall, ToolCallUpdate } from '@runlith/acp/toolCalls';
import type { AgentPhase } from '@runlith/agent/AgentPhase';
import { COMPACTED, INPUT, PHASE, SAID } from '../../contract/wire/extensions.js';
import type { Handed } from './handed.js';

export type Said = { readonly messageId: string; readonly toolCallIds: readonly string[] };
export type OutputEvent =
  | { readonly type: 'text' | 'thought'; readonly messageId: string; readonly text: string }
  | { readonly type: 'call'; readonly call: ToolCall; readonly hosted: boolean }
  | { readonly type: 'result'; readonly result: ToolCallUpdate; readonly hosted: boolean }
  | { readonly type: 'usage'; readonly update: Extract<SessionUpdate, { sessionUpdate: 'usage_update' }> }
  | { readonly type: 'said'; readonly said: Said }
  | { readonly type: 'phase'; readonly phase: AgentPhase['phase'] }
  | { readonly type: 'input'; readonly toolCallId: string; readonly name: string; readonly delta: string }
  | {
      readonly type: 'compacted';
      readonly summary: string;
      readonly trigger: 'manual' | 'auto';
      readonly preTokens?: number;
      readonly postTokens?: number;
    }
  | { readonly type: 'notification'; readonly method: string; readonly fields: Readonly<Record<string, unknown>> };

export class Output {
  constructor(
    private readonly id: string,
    private readonly outlet: Outlet,
    private readonly handed: Handed,
  ) {}

  readonly emit = Effect.fnUntraced(function* (this: Output, updates: readonly SessionUpdate[]) {
    for (const update of updates) yield* this.outlet.update({ sessionId: this.id, update });
  });

  notify(method: string, fields: Readonly<Record<string, unknown>>): Effect.Effect<void> {
    return this.outlet.notify(method, { sessionId: this.id, ...fields });
  }

  said(said: Said): Effect.Effect<void> {
    return this.notify(SAID, said);
  }

  event(event: OutputEvent): Effect.Effect<void> {
    switch (event.type) {
      case 'text':
      case 'thought':
        return this.emit(
          event.text === ''
            ? []
            : [
                {
                  sessionUpdate: event.type === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk',
                  messageId: event.messageId,
                  content: { type: 'text', text: event.text },
                },
              ],
        );
      case 'call':
        return this.emit([{ ...event.call, sessionUpdate: 'tool_call', _meta: this.handed.offered(event.hosted) ?? event.call._meta }]);
      case 'result': {
        if (event.result.status !== 'completed' && event.result.status !== 'failed')
          return this.emit([{ ...event.result, sessionUpdate: 'tool_call_update' }]);
        return this.emit([
          {
            ...event.result,
            sessionUpdate: 'tool_call_update',
            _meta: this.handed.answered(event.result.toolCallId, event.hosted) ?? event.result._meta,
          },
        ]);
      }
      case 'usage':
        return this.emit([event.update]);
      case 'said':
        return this.said(event.said);
      case 'phase':
        return this.notify(PHASE, { phase: event.phase });
      case 'input':
        return this.notify(INPUT, { toolCallId: event.toolCallId, name: event.name, delta: event.delta });
      case 'compacted':
        return this.notify(COMPACTED, {
          trigger: event.trigger,
          summary: event.summary,
          preTokens: event.preTokens,
          postTokens: event.postTokens,
        });
      case 'notification':
        return this.notify(event.method, event.fields);
    }
  }
}

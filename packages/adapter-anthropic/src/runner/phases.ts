import { Schema } from 'effect';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentPhase } from '@runlith/agent/AgentPhase';

type Phase = AgentPhase['phase'];

const isStarted = Schema.is(
  Schema.Struct({
    type: Schema.Literal('content_block_start'),
    index: Schema.Number,
    content_block: Schema.Struct({ type: Schema.String }),
  }),
);
const isStopped = Schema.is(Schema.Struct({ type: Schema.Literal('content_block_stop'), index: Schema.Number }));
const isFrame = Schema.is(Schema.Struct({ type: Schema.String }));

const BLOCKS: Readonly<Record<string, Phase>> = {
  thinking: 'reasoning',
  redacted_thinking: 'reasoning',
  text: 'writing',
  tool_use: 'tools',
  server_tool_use: 'tools',
};

export class Phases {
  private current: Phase | null = null;
  private readonly open = new Map<number, Phase>();
  private using = false;

  heard(): Phase | null {
    return this.entered('calling');
  }

  streamed(event: unknown): Phase | null {
    if (isStarted(event)) {
      const phase = BLOCKS[event.content_block.type];
      if (phase === undefined) return null;
      this.open.set(event.index, phase);
      if (phase === 'tools') this.using = true;
      return this.entered(phase);
    }
    if (isStopped(event)) {
      const phase = this.open.get(event.index);
      this.open.delete(event.index);
      return phase === 'reasoning' || phase === 'writing' ? this.entered('calling') : null;
    }
    if (!isFrame(event)) return null;
    if (event.type === 'message_start') {
      this.open.clear();
      this.using = false;
      return this.entered('calling');
    }
    return event.type === 'message_stop' && !this.using ? this.entered('calling') : null;
  }

  noted(message: Extract<SDKMessage, { readonly type: 'system' }>): Phase | null {
    if (message.subtype === 'api_retry') return this.entered('retrying');
    if (message.subtype === 'compact_boundary') return this.entered('calling');
    if (message.subtype !== 'status') return null;
    if (message.status === 'compacting') return this.entered('compacting');
    return message.status === 'requesting' ? this.entered('calling') : null;
  }

  private entered(phase: Phase): Phase | null {
    if (this.current === phase) return null;
    this.current = phase;
    return phase;
  }
}

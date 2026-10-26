import { Schema } from 'effect';
import { toolOf } from './translate.js';

const isStarted = Schema.is(
  Schema.Struct({
    type: Schema.Literal('content_block_start'),
    index: Schema.Number,
    content_block: Schema.Struct({ type: Schema.Literal('tool_use'), id: Schema.String, name: Schema.String }),
  }),
);

const isDelta = Schema.is(
  Schema.Struct({
    type: Schema.Literal('content_block_delta'),
    index: Schema.Number,
    delta: Schema.Struct({ type: Schema.Literal('input_json_delta'), partial_json: Schema.String }),
  }),
);

const isMessageStart = Schema.is(Schema.Struct({ type: Schema.Literal('message_start') }));

export type InputGrowth = { readonly toolCallId: string; readonly name: string; readonly delta: string };

type Open = { readonly toolCallId: string; readonly name: string };

export class Inputs {
  private readonly open = new Map<number, Open>();

  streamed(event: unknown): InputGrowth | null {
    if (isMessageStart(event)) this.open.clear();
    if (isStarted(event)) {
      const open = { toolCallId: event.content_block.id, name: toolOf(event.content_block.name) };
      this.open.set(event.index, open);
      return { ...open, delta: '' };
    }
    if (!isDelta(event)) return null;
    const open = this.open.get(event.index);
    return open === undefined ? null : { ...open, delta: event.delta.partial_json };
  }
}

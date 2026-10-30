import { Schema } from 'effect';
import type { ClientEvent } from '@runlith/acp/events';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { LiveDelta } from '@runlith/agent/thread/run/lifecycle/RunReports';
import { INPUT, Input, PHASE, Phased, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import { textOf } from './content.js';
import type { OpenedTurn } from './row.js';

type Signaled = Extract<ClientEvent, { readonly _tag: 'Signaled' }>;

export type Live = { readonly run: ThreadRunRef; readonly delta: LiveDelta };

export type LiveRead = { readonly live: readonly Live[]; readonly unread: readonly Signaled[] };

const phased = Schema.is(Phased);

const input = Schema.is(Input);

export const liveOf = (turns: readonly OpenedTurn[], threadId: string, events: readonly ClientEvent[]): LiveRead => {
  const positions = new Map(turns.map((turn) => [turn.id, turn.parts]));
  const live: Live[] = [];
  const unread: Signaled[] = [];
  for (const event of events) {
    const retried = event._tag === 'Extended' && event.method === RETRYING ? turns.at(-1)?.id : undefined;
    if (retried !== undefined) live.push({ run: { id: retried, threadId }, delta: { op: 'retry' } });
    if (event._tag === 'Signaled') {
      const run = event.turn === null || !positions.has(event.turn) ? null : { id: event.turn, threadId };
      if (event.method === PHASE && phased(event.params)) {
        if (run !== null) live.push({ run, delta: { op: 'phase', phase: event.params.phase } });
      } else if (event.method === INPUT && input(event.params)) {
        const { toolCallId, name, delta } = event.params;
        if (run !== null) live.push({ run, delta: { op: 'tool-input', callId: toolCallId, name, text: delta } });
      } else unread.push(event);
      continue;
    }
    if (event._tag !== 'Delta' && event._tag !== 'Message') continue;
    const parts = positions.get(event.turn);
    if (parts === undefined) continue;
    const stream = (event._tag === 'Message' ? event.message.stream : event.stream) === 'message' ? 'message' : 'reasoning';
    const key = stream === 'message' ? 'text' : 'reasoning';
    const run = { id: event.turn, threadId };
    if (event._tag === 'Delta') {
      live.push({ run, delta: { op: 'append', stream, part: parts[key], text: textOf([event.content]) } });
    } else if (textOf(event.message.content).trim() !== '') {
      live.push({ run, delta: { op: 'seal', stream, part: parts[key] } });
      positions.set(event.turn, { ...parts, [key]: parts[key] + 1 });
    }
  }
  return { live, unread };
};

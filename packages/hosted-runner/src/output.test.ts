import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { Outlet } from '@runlith/acp/agent';
import { EXECUTES, SAID } from './wire/extensions.js';
import { Handed } from './handed.js';
import { Output } from './output.js';

const recorded = () => {
  const frames: unknown[] = [];
  const outlet: Outlet = {
    update: (frame) =>
      Effect.sync(() => {
        frames.push(frame.update);
      }),
    notify: (method, params) =>
      Effect.sync(() => {
        frames.push({ method, params });
      }),
    request: () => Effect.die('this output asks no question'),
  };
  return { frames, outlet };
};

it.effect(
  'a message boundary goes out at once, even naming a call never announced, so the driver refuses it instead of the session waiting',
  () =>
    Effect.gen(function* () {
      const { frames, outlet } = recorded();
      const output = new Output('session', outlet, new Handed());
      yield* output.event({ type: 'said', said: { messageId: 'cut', toolCallIds: ['never'] } });
      yield* output.event({ type: 'said', said: { messageId: 'next', toolCallIds: [] } });
      expect(frames).toEqual([
        { method: SAID, params: { sessionId: 'session', messageId: 'cut', toolCallIds: ['never'] } },
        { method: SAID, params: { sessionId: 'session', messageId: 'next', toolCallIds: [] } },
      ]);
    }),
);

it.effect('partial input leaves execution ownership for the terminal result', () =>
  Effect.gen(function* () {
    const { frames, outlet } = recorded();
    const handed = new Handed();
    const output = new Output('session', outlet, handed);
    yield* output.event({ type: 'call', hosted: true, call: { toolCallId: 'call', title: 'read', name: 'read', status: 'pending' } });
    handed.add('call');
    yield* output.event({ type: 'result', hosted: true, result: { toolCallId: 'call', rawInput: { path: '/file' } } });
    yield* output.event({ type: 'result', hosted: true, result: { toolCallId: 'call', status: 'completed', rawOutput: 'contents' } });
    yield* output.event({ type: 'call', hosted: true, call: { toolCallId: 'rejected', title: 'read', name: 'read' } });
    yield* output.event({
      type: 'result',
      hosted: true,
      result: { toolCallId: 'rejected', status: 'failed', rawOutput: 'the vendor rejected this call' },
    });
    expect(frames).toEqual([
      expect.objectContaining({ sessionUpdate: 'tool_call', toolCallId: 'call', _meta: { [EXECUTES]: true } }),
      { sessionUpdate: 'tool_call_update', toolCallId: 'call', rawInput: { path: '/file' } },
      expect.objectContaining({ sessionUpdate: 'tool_call_update', toolCallId: 'call', status: 'completed', _meta: { [EXECUTES]: true } }),
      expect.objectContaining({ sessionUpdate: 'tool_call', toolCallId: 'rejected', _meta: { [EXECUTES]: true } }),
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'rejected',
        status: 'failed',
        _meta: { [EXECUTES]: false },
      }),
    ]);
  }),
);

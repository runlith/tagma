import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Bridge, type BridgeVendor } from './bridge.js';
import type { HostedDoor } from './door.js';
import { Handed } from './handed.js';

const muse: BridgeVendor = {
  name: 'Muse Code',
  callIdOf: (meta) => (typeof meta.callId === 'string' && meta.callId !== '' ? meta.callId : null),
  relists: false,
};

const read = { name: 'read', description: 'Reads a file.', inputSchema: { properties: {} }, mutates: false };

const bridgeOf = (door: HostedDoor, handed: Handed, vendor: BridgeVendor) =>
  new Bridge(
    door,
    handed,
    () => {},
    () => Effect.void,
    () => Effect.void,
    vendor,
  );

it.effect('a bridge runs a call under the vendor-read call id and refuses one that names none', () =>
  Effect.gen(function* () {
    const ran: string[] = [];
    const door: HostedDoor = {
      agent: () => Effect.die('no agent'),
      history: () => Effect.die('no history'),
      turn: () => Effect.die('no turn'),
      tools: () => Effect.succeed({ tools: [read], names: ['read'] }),
      call: (toolCallId, name) => {
        ran.push(`${toolCallId}:${name}`);
        return Effect.succeed({
          status: 'called' as const,
          content: [{ type: 'text' as const, text: 'done' }],
          failed: false,
          offered: false,
          words: [],
        });
      },
    };
    const handed = new Handed();
    const bridge = bridgeOf(door, handed, muse);
    const answer = yield* Effect.promise(() => bridge.input.call('read', {}, { callId: 'call-1' }, 1, new AbortController().signal));
    expect([answer.text, answer.isError, ran, handed.taken('call-1')]).toEqual(['done', false, ['call-1:read'], true]);
    const refused = yield* Effect.promise(() =>
      bridge.input.call('read', {}, { 'claudecode/toolUseId': 'toolu_1' }, 2, new AbortController().signal),
    );
    expect([refused.isError, refused.text.startsWith('Muse Code called read'), ran]).toEqual([true, true, ['call-1:read']]);
  }),
);

it.effect('a bridge for a vendor that never relists serves a changed list at once, with no notification and no wait', () =>
  Effect.gen(function* () {
    const bridge = bridgeOf(
      {
        agent: () => Effect.die('no agent'),
        history: () => Effect.die('no history'),
        turn: () => Effect.die('no turn'),
        tools: () => Effect.die('no list read'),
        call: () => Effect.die('no call'),
      },
      new Handed(),
      muse,
    );
    expect(bridge.input.tools()).toEqual([]);
    yield* bridge.serve([read]);
    expect(bridge.input.tools().map((tool) => tool.name)).toEqual(['read']);
  }),
);

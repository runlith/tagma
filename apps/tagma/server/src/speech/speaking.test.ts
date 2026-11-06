import { expect } from 'bun:test';
import { AudioDevices } from '@runlith/audio/port/devices';
import { it } from '@runlith/effect-test';
import { Speech } from '@runlith/speech/engine/Speech';
import { voiced } from '@runlith/speech/testing/models';
import { incoming, scriptedProvider } from '@runlith/speech/testing/scriptedProvider';
import { inWorld, ready, settle } from '@runlith/speech/testing/world';
import { Effect, Fiber, Stream } from 'effect';
import { Settings } from '../settings/contract/service/values.js';
import { makeSpeaking } from './speaking.js';

const settings = Settings.of({
  read: () => Effect.die('read'),
  value: (key) => Effect.succeed(key.fallback),
  chain: () => Effect.die('chain'),
  live: () => Effect.die('live'),
  held: () => Effect.die('held'),
  changes: () => Effect.die('changes'),
  write: () => Effect.die('write'),
  amend: () => Effect.die('amend'),
});
const provider = scriptedProvider({ id: 'scripted', synthesis: [voiced('voice', 'stream')] });
const devices = AudioDevices.none('headless server');

it.effect('synthesis streams its chosen format and PCM to a caller without opening a server player', () =>
  inWorld([provider], (world) =>
    Effect.gen(function* () {
      const speaker = yield* makeSpeaking.pipe(Effect.provideService(Speech, world.service), Effect.provideService(Settings, settings));
      const output = yield* Effect.forkChild(Stream.runCollect(speaker.audio({ text: 'Bonjour' })));
      const link = yield* world.transport.next;
      yield* link.receive(ready);
      yield* settle;
      yield* link.receive(incoming({ type: 'audio', pcm: [-32768, 0, 32767] }));
      yield* link.receive(incoming({ type: 'done' }));
      expect(yield* Fiber.join(output)).toEqual([
        { kind: 'voice', provider: 'scripted', model: 'voice', voice: 'calm', format: { rate: 24000, channels: 1 } },
        { kind: 'audio', pcm: Uint8Array.from([0, 128, 0, 0, 255, 127]) },
      ]);
      expect(world.transport.live()).toBe(0);
    }).pipe(Effect.provide(devices)),
  ),
);

it.effect('unsubscribing from synthesized audio releases the provider while it is still producing', () =>
  inWorld([provider], (world) =>
    Effect.gen(function* () {
      const speaker = yield* makeSpeaking.pipe(Effect.provideService(Speech, world.service), Effect.provideService(Settings, settings));
      const output = yield* Effect.forkChild(Stream.runDrain(speaker.audio({ text: 'Bonjour' })));
      const link = yield* world.transport.next;
      yield* link.receive(ready);
      yield* Fiber.interrupt(output);
      expect(link.isClosed()).toBe(true);
      expect(world.transport.live()).toBe(0);
    }).pipe(Effect.provide(devices)),
  ),
);

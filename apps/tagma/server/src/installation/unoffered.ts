import { Clock, Effect, Layer, Stream } from 'effect';
import { NextInstallation } from './contract/service/next.js';
import type { NextFrame } from './contract/wire/next.js';

export const unofferedLayer = Layer.effect(
  NextInstallation,
  Effect.gen(function* () {
    const frame: NextFrame = {
      instance: crypto.randomUUID(),
      pid: process.pid,
      revision: 1,
      readAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      readFrom: null,
      watched: false,
      issue: null,
      standing: { tone: 'alone', said: [{ text: 'This build is offered no other version.', strong: false }], behind: null },
      offers: [],
      update: null,
      back: null,
      installing: null,
      installed: null,
      acts: [],
    };
    return NextInstallation.of({
      reading: Effect.succeed(frame),
      changes: Stream.concat(Stream.make(frame), Stream.never),
      installing: Effect.succeed(null),
      install: (offer) =>
        Effect.fail({
          code: 'no-offer',
          reason: `this build offers no version to install, so "${offer}" is not offered`,
          unblock: ['install through a build that offers versions'],
        }),
      stop: () => Effect.fail({ code: 'nothing-installing', reason: 'nothing is installing', unblock: ['nothing to stop'] }),
    });
  }),
);

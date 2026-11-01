import { speech as declaration } from './contract/wire/module.js';
import { join } from 'node:path';
import { Context, Effect } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { BRIDGE_METHODS } from '../views/contract/service/bridge.js';
import { SPEECH_BRIDGE } from './contract/wire/view.js';
import { speechCapability } from './contract/wire/capability.js';
import { Captures } from './contract/service/captures.js';
import { Models } from './contract/service/models.js';
import { Recognitions } from './contract/service/recognitions.js';
import { Speaking } from './contract/service/speaking.js';
import type { SpeechLive } from './contract/service/live.js';
import { SPEECH_FEEDS } from './contract/wire/feeds.js';
import { SPEECH_SETTING_SECTIONS, SPEECH_SETTINGS } from './keys.js';

const live: SpeechLive = liveOf(SPEECH_FEEDS, async (door) =>
  (await import('./feeds.js')).speechChannels({
    recognitions: Context.get(door, Recognitions),
    captures: Context.get(door, Captures),
    models: Context.get(door, Models),
    speaking: Context.get(door, Speaking),
  }),
);

export const speech = manifest({
  ...declaration,
  capabilities: [speechCapability],
  bodies: async () => Object.values((await import('./operations.js')).SPEECH_PAIRS),
  live,
  settings: SPEECH_SETTINGS,
  settingSections: SPEECH_SETTING_SECTIONS,
  contributions: [
    ...BRIDGE_METHODS.of(SPEECH_BRIDGE),
    ...RELOCATIONS.of({
      id: 'speech/recordings',
      carried: (data) => [join(data, 'recordings')],
      relocate: () => Effect.succeed([]),
    }),
  ],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ speechLayer }) => speechLayer,
    ),
  },
});

import { speech as declaration } from './contract/wire/module.js';
import { join } from 'node:path';
import { Context, Effect } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { HOME_FOLLOWERS } from '../thread-record/contract/service/homes.js';
import { RECORDINGS } from './contract/service/recording.js';
import { speechCapability } from './contract/wire/capability.js';
import { Listenings } from './contract/service/listenings.js';
import { Models } from './contract/service/models.js';
import { Speaking } from './contract/service/speaking.js';
import type { SpeechLive } from './contract/service/live.js';
import { SPEECH_FEEDS } from './contract/wire/feeds.js';
import { SPEECH_SETTING_SECTIONS, SPEECH_SETTINGS } from './keys.js';

const live: SpeechLive = liveOf(SPEECH_FEEDS, async (door) =>
  (await import('./feeds.js')).speechChannels(Context.get(door, Listenings), Context.get(door, Models), Context.get(door, Speaking)),
);

export const speech = manifest({
  ...declaration,
  capabilities: [speechCapability],
  bodies: async () => Object.values((await import('./operations.js')).SPEECH_PAIRS),
  live,
  tables: async () => {
    const [{ listening, listeningSpeaker, listeningFollower, listeningGiven, transcriptLine, transcriptEntry, transcriptStaged }] =
      await Promise.all([import('./store/tables.js')]);
    return {
      entities: [listening, listeningSpeaker, listeningFollower, listeningGiven],
      history: [transcriptLine, transcriptEntry, transcriptStaged],
    };
  },
  settings: SPEECH_SETTINGS,
  settingSections: SPEECH_SETTING_SECTIONS,
  contributions: [
    ...RELOCATIONS.of({
      id: 'speech/recordings',
      carried: (data) => [join(data, RECORDINGS)],
      relocate: () => Effect.succeed([]),
    }),
    ...HOME_FOLLOWERS.of({ id: 'speech/followers', load: async () => (await import('./homes.js')).speechHomes }),
  ],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ speechLayer }) => speechLayer,
    ),
  },
});

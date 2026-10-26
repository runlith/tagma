import { CHANNEL } from '@tagma/server/composition/channel';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import { applications } from '../../mac-applications/placement.js';
import { releasePlaces } from '../../release-channel/places.js';
import { releaseChannelLayer } from '../../release-channel/runner.js';
import { macPlatform } from '../../installation/setup/macos.js';
import type { Bindings, NextPlace } from '../next.js';

const nextInstallation = (place: NextPlace) =>
  releaseChannelLayer({
    installations: place.installations,
    name: CHANNEL.name,
    running: place.installation?.manifest.identity.build ?? PROGRAM_RELEASE,
    runsFrom: place.installation,
    places: releasePlaces(place.dataPath),
    applications,
    machine: macPlatform,
    downgrade: place.downgrade,
    restart: place.restart,
    refuses: place.refuses,
    env: process.env,
  });

export const BINDINGS: Bindings = { nextInstallation };

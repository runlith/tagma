import { Context, Effect, Layer } from 'effect';
import { Automation } from './contract/service/automation.js';
import { Pages } from './contract/service/pages.js';
import { Profiles } from './contract/service/profiles.js';
import { ThreadRuns } from './contract/service/runs.js';
import { Screencast } from './contract/service/screencast.js';
import { makeAutomation } from './engine/automation.js';
import { makeDrive } from './engine/drive.js';
import { makeScreencast } from './engine/screencast.js';
import { hostsLayer } from './hosts.js';
import { pagesLayer } from './pages.js';
import { profilesLayer } from './profiles.js';
import { ledgerLayer } from './store/ledger.js';

const engineLayer = Layer.effectContext(
  Effect.gen(function* () {
    const pages = yield* Pages;
    const drive = yield* makeDrive({ pages, profiles: yield* Profiles, runs: yield* ThreadRuns });
    const automation = yield* makeAutomation({ drive });
    const screencast = yield* makeScreencast({ pages, drive });
    return Context.make(Automation, automation).pipe(Context.add(Screencast, screencast));
  }),
);

export const browserLayer = engineLayer.pipe(
  Layer.provideMerge(profilesLayer),
  Layer.provideMerge(pagesLayer),
  Layer.provideMerge(hostsLayer),
  Layer.provide(ledgerLayer),
);

import { Context } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { Automation } from './contract/service/automation.js';
import type { BrowserLive } from './contract/service/live.js';
import { Pages } from './contract/service/pages.js';
import { Screencast } from './contract/service/screencast.js';
import { browserCapability } from './contract/wire/capability.js';
import { BROWSER_FEEDS } from './contract/wire/feeds.js';
import { browser as declaration } from './contract/wire/module.js';
import { BROWSER_SETTING_SECTIONS, BROWSER_SETTINGS } from './contract/wire/settings.js';
import { browserPages } from './doctrine/browserPages.js';

const live: BrowserLive = liveOf(BROWSER_FEEDS, async (door) =>
  (await import('./feeds.js')).browserChannels(Context.get(door, Pages), Context.get(door, Automation), Context.get(door, Screencast)),
);

export const browser = manifest({
  ...declaration,
  capabilities: [browserCapability],
  sections: [
    {
      id: 'browser-pages',
      place: { prompt: 46 },
      owner: 'browser',
      render: browserPages,
      path: 'src/browser/doctrine/browserPages.ts',
    },
  ],
  bodies: async () => {
    const [{ COOKIE_PAIRS, PAGE_PAIRS, PROFILE_PAIRS }, { TRACE_PAIRS }, { RECORD_PAIRS }, { AUDIT_PAIRS }] = await Promise.all([
      import('./operations.js'),
      import('./traces.js'),
      import('./recordings.js'),
      import('./audits.js'),
    ]);
    return [
      ...Object.values(PAGE_PAIRS),
      ...Object.values(PROFILE_PAIRS),
      ...Object.values(COOKIE_PAIRS),
      ...Object.values(TRACE_PAIRS),
      ...Object.values(RECORD_PAIRS),
      ...Object.values(AUDIT_PAIRS),
    ];
  },
  live,
  tables: async () => {
    const { browserPage, browserProfile } = await import('./store/tables.js');
    return { entities: [browserProfile, browserPage], history: [] };
  },
  settings: BROWSER_SETTINGS,
  settingSections: BROWSER_SETTING_SECTIONS,
  drivers: [{ id: 'browser-idle-pages' }],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ browserLayer }) => browserLayer,
    ),
  },
});

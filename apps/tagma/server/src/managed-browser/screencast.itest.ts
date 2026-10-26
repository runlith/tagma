import { screencastScenarios } from '../browser/testing/screencast.js';
import { MANAGED_AGENT, managedAdapter } from './adapter.js';
import { managedFixture } from './testing/host.js';

screencastScenarios({
  name: 'the managed Chromium',
  adapter: managedAdapter,
  profile: MANAGED_AGENT,
  fixture: managedFixture,
});

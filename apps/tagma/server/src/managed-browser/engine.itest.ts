import { engineScenarios } from '../browser/testing/scenarios.js';
import { MANAGED_AGENT, managedAdapter } from './adapter.js';
import { managedFixture } from './testing/host.js';

engineScenarios({
  name: 'the managed Chromium',
  adapter: managedAdapter,
  profile: MANAGED_AGENT,
  fixture: managedFixture,
});

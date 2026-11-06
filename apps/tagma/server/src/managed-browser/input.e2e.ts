import { inputScenarios } from '../browser/testing/input.js';
import { MANAGED_AGENT, managedAdapter } from './adapter.js';
import { managedFixture } from './testing/host.js';

inputScenarios({ name: 'managed Chromium', adapter: managedAdapter, profile: MANAGED_AGENT, rendererCpu: false, fixture: managedFixture });

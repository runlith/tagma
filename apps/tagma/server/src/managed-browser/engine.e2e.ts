import { engineScenarios, type EngineHost } from '../browser/testing/scenarios.js';
import { traceScenarios } from '../browser/testing/traceScenarios.js';
import { heapScenarios } from '../browser/testing/heapScenarios.js';
import { auditScenarios } from '../browser/testing/auditScenarios.js';
import { MANAGED_AGENT, managedAdapter } from './adapter.js';
import { managedFixture } from './testing/host.js';

const host: EngineHost = {
  name: 'the managed Chromium',
  adapter: managedAdapter,
  profile: MANAGED_AGENT,
  rendererCpu: false,
  fixture: managedFixture,
};

engineScenarios(host);
traceScenarios(host);
heapScenarios(host);
auditScenarios(host);

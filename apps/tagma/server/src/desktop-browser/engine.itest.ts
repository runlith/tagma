import { engineScenarios, type EngineHost } from '../browser/testing/scenarios.js';
import { traceScenarios } from '../browser/testing/traceScenarios.js';
import { heapScenarios } from '../browser/testing/heapScenarios.js';
import { auditScenarios } from '../browser/testing/auditScenarios.js';
import { AGENT_PROFILE } from '../browser/contract/wire/ids.js';
import { desktopAdapter } from './adapter.js';
import { desktopFixture } from './testing/electron.js';

const host: EngineHost = {
  name: 'the desktop host',
  adapter: desktopAdapter,
  profile: AGENT_PROFILE,
  fixture: desktopFixture,
};

engineScenarios(host);
traceScenarios(host);
heapScenarios(host);
auditScenarios(host);

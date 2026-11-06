import { inputScenarios } from '../browser/testing/input.js';
import { AGENT_PROFILE } from '../browser/contract/wire/ids.js';
import { desktopAdapter } from './adapter.js';
import { desktopFixture } from './testing/electron.js';

inputScenarios({ name: 'desktop Electron', adapter: desktopAdapter, profile: AGENT_PROFILE, rendererCpu: true, fixture: desktopFixture });

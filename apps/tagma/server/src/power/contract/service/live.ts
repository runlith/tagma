import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { AWAKE_FEED, PACE_FEED } from '../wire/power.js';
import type { AwakePolicy } from './awake.js';
import type { AgentPace } from './pace.js';

export type PowerLive = LiveDeclaration<readonly [typeof AWAKE_FEED, typeof PACE_FEED], AwakePolicy | AgentPace>;

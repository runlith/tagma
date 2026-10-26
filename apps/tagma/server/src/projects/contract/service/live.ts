import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { PROJECTS_FEED } from '../wire/feed.js';
import type { ProjectChanges } from './changes.js';
import type { Projects } from './registry.js';

export type ProjectsLive = LiveDeclaration<readonly [typeof PROJECTS_FEED], Projects | ProjectChanges>;

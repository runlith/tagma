import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { PROJECTS_FEED } from './feed.js';

export const projects = {
  id: 'projects',
  feeds: [PROJECTS_FEED],
} as const satisfies WireModule;

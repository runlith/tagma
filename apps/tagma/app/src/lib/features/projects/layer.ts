import { Layer } from '@runlith/layer/Layer';
import { ProjectPrefetch } from './Prefetch.js';
import { ProjectPulse } from './Pulse.svelte.js';
import { ProjectRemoval } from './Removal.svelte.js';
import { ProjectRenaming } from './Renaming.svelte.js';
import { ProjectStrip } from './Strip.svelte.js';
import { ProjectGrouping } from './Grouping.svelte.js';

export const ProjectsLayer = Layer.mergeAll(ProjectStrip, ProjectPulse, ProjectPrefetch, ProjectRemoval, ProjectRenaming, ProjectGrouping);

import { Layer } from '@runlith/layer/Layer';
import { ProjectPrefetch } from './Prefetch.js';
import { ProjectPulse } from './Pulse.svelte.js';
import { ProjectRemoval } from './Removal.svelte.js';
import { ProjectStrip } from './Strip.svelte.js';

export const ProjectsLayer = Layer.mergeAll(ProjectStrip, ProjectPulse, ProjectPrefetch, ProjectRemoval);

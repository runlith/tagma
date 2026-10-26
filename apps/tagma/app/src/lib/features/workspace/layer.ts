import { Layer } from '@runlith/layer/Layer';
import { Addresses } from './Addresses.js';
import { ProjectFocus } from './Focus.svelte.js';
import { GraphRungSource } from './GraphRung.js';
import { ProjectDoor } from './ProjectDoor.js';
import { ProjectsFeed } from './ProjectsFeed.js';
import { ProjectRungSource } from './ProjectRung.js';
import { ProjectsRepo } from './ProjectsRepo.js';
import { WallClock } from './WallClock.svelte.js';
import { Workspace } from './Selection.svelte.js';

export const WorkspaceLayer = Layer.mergeAll(
  Workspace,
  ProjectsRepo,
  ProjectsFeed,
  WallClock,
  ProjectRungSource,
  ProjectDoor,
  GraphRungSource,
  ProjectFocus,
  Addresses,
);

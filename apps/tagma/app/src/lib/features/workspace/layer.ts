import { Layer } from '@runlith/layer/Layer';
import { Addresses } from './Addresses.js';
import { ProjectFocus } from './Focus.svelte.js';
import { GraphRungSource } from './GraphRung.js';
import { ProjectDoor } from './ProjectDoor.js';
import { ProjectsFeed } from './ProjectsFeed.js';
import { ProjectRungSource } from './ProjectRung.js';
import { ProjectsRepo } from './ProjectsRepo.js';
import { TileRungSource } from './TileRung.js';
import { WallClock } from './WallClock.svelte.js';
import { Workspace } from './Selection.svelte.js';
import { Actions } from './action.js';
import { SurfaceActions } from './actions.js';
import { Columns } from './column.js';
import { Surfaces, SurfaceRegistry } from './surface.js';

export const WorkspaceLayer = Layer.mergeAll(
  Surfaces,
  SurfaceRegistry,
  Columns,
  Actions,
  SurfaceActions,
  Workspace,
  ProjectsRepo,
  ProjectsFeed,
  WallClock,
  TileRungSource,
  ProjectRungSource,
  ProjectDoor,
  GraphRungSource,
  ProjectFocus,
  Addresses,
);

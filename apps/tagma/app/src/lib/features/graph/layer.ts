import { Layer } from '@runlith/layer/Layer';
import { BlockLayer } from './block/layer.js';
import { BlocksRepo } from './BlocksRepo.js';
import { BlockTitles } from './BlockTitles.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { GraphFeed } from './Feed.js';
import { HiddenStates } from './HiddenStates.svelte.js';
import { JournalLayer } from './journal/layer.js';
import { JournalRepo } from './JournalRepo.js';
import { ProjectTree } from './ProjectTree.svelte.js';
import { SelectionRepo } from './SelectionRepo.js';
import { Sidebar } from './sidebar/Sidebar.svelte.js';
import { SessionRegistry } from './SessionRegistry.svelte.js';
import { SessionsRepo } from './SessionsRepo.js';
import { GraphSelection } from './GraphSelection.svelte.js';
import { TagCatalog } from './TagCatalog.svelte.js';
import { TagsRepo } from './TagsRepo.js';
import { Recovery } from './Recovery.svelte.js';
import { RemoteRepo } from './RemoteRepo.js';
import { ThreadWork } from './ThreadWork.svelte.js';
import { ThreadWorkRepo } from './ThreadWorkRepo.js';

export const GraphLayer = Layer.mergeAll(
  ThreadWorkRepo,
  ThreadWork,
  Sidebar,
  GraphDoor,
  Recovery,
  RemoteRepo,
  BlocksRepo,
  JournalRepo,
  SessionsRepo,
  SelectionRepo,
  GraphFeed,
  ProjectTree,
  BlockTitles,
  SessionRegistry,
  TagsRepo,
  TagCatalog,
  HiddenStates,
  GraphSelection,
  BlockLayer,
  JournalLayer,
);

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
import { ThreadWork } from './ThreadWork.svelte.js';
import { ThreadWorkRepo } from './ThreadWorkRepo.js';
import { TranslationLayer } from './translation/layer.js';
import { LinkKinds, LinkMenuItems } from '$lib/features/opening/Link.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { PaletteActions } from '$lib/features/workspace/action.js';
import { Columns } from '$lib/features/workspace/column.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { actions } from './actions.js';
import { columns } from './columns.js';
import { items, links } from './links.js';
import { panes } from './panes.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const GraphLayer = Layer.mergeAll(
  Surfaces.contribute('graph', ...surfaces),
  Panes.contribute('graph', ...panes),
  Columns.contribute('graph', ...columns),
  SettingSections.contribute('graph', ...sections),
  LinkKinds.contribute('graph', ...links),
  LinkMenuItems.contribute('graph', ...items),
  PaletteActions.contribute('graph', { id: 'graph', actions }),
  ThreadWorkRepo,
  ThreadWork,
  Sidebar,
  GraphDoor,
  Recovery,
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
  TranslationLayer,
);

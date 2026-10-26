import Compass from '@lucide/svelte/icons/compass';
import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
import ListTree from '@lucide/svelte/icons/list-tree';
import Ruler from '@lucide/svelte/icons/ruler';
import GraphFilesSection from '$lib/features/graph/GraphFilesSection.svelte';
import OutlineSection from '$lib/features/graph/OutlineSection.svelte';
import WritingSection from '$lib/features/graph/WritingSection.svelte';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [
  { id: 'graph', group: 'project', order: 1, icon: FolderGit2, view: GraphFilesSection },
  { id: 'writing', group: 'project', order: 2, icon: Ruler, view: WritingSection },
  { id: 'orientation', group: 'project', order: 4, icon: Compass },
  {
    id: 'outline',
    group: 'interface',
    order: 2,
    icon: ListTree,
    view: OutlineSection,
    place: 'This browser',
    local: {
      title: 'Outline',
      description: 'What the tree leaves out. Hidden blocks stay in the graph, the map and search.',
    },
  },
];

import Columns2 from '@lucide/svelte/icons/columns-2';
import Plus from '@lucide/svelte/icons/plus';
import { Overlay } from '@runlith/primitives/Overlay.svelte';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import type { PaletteActionList } from '$lib/features/workspace/action.js';
import { AgentTypes } from '$lib/features/threads/AgentTypes.svelte.js';
import { AgentLibraryOverlay } from '$lib/features/threads/overlay.js';
import LibraryIcon from './LibraryIcon.svelte';
import { PageDraft } from './PageDraft.js';
import { THREAD_PANE } from './seats/pane.js';

export const actions: PaletteActionList = [
  {
    id: 'thread.new',
    order: 10,
    title: 'New thread',
    keywords: ['agent', 'chat', 'draft'],
    icon: Plus,
    available: (env) => env.project !== null,
    run: (env) => {
      if (env.project !== null) env.resolve(PageDraft).start(env.project);
    },
  },
  {
    id: 'panes.split',
    order: 35,
    title: 'Split right',
    keywords: ['pane', 'side', 'beside', 'thread'],
    icon: Columns2,
    available: (env) => env.routeProject !== null,
    run: (env) => {
      env.resolve(SidePanes).open({ kind: THREAD_PANE, id: null });
    },
  },
  {
    id: 'agents.library',
    order: 60,
    title: 'Agent library',
    keywords: ['agents', 'definitions', 'profiles'],
    icon: LibraryIcon,
    available: (env) => env.project !== null && env.routeProject !== null,
    run: (env) => {
      if (env.project === null) return;
      const types = env.resolve(AgentTypes);
      env.resolve(Overlay).open(AgentLibraryOverlay, { projectId: env.project.id, onSaved: () => void types.read(true) });
    },
  },
];

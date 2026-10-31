import Share2 from '@lucide/svelte/icons/share-2';
import type { SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import JournalIcon from './JournalIcon.svelte';
import KnowledgeIcon from './KnowledgeIcon.svelte';

export const surfaces: readonly SurfaceDeclaration[] = [
  {
    surface: 'outline',
    route: '',
    place: 'b',
    label: 'Knowledge',
    icon: KnowledgeIcon,
    rail: 30,
    pinned: true,
    stands: 'graph',
    column: 'knowledge',
    remembers: false,
    scoped: true,
  },
  {
    surface: 'graph',
    route: 'graph',
    label: 'Graph',
    icon: Share2,
    under: 'outline',
    stands: 'graph',
    remembers: true,
    scoped: true,
  },
  {
    surface: 'journal',
    route: 'journal',
    label: 'Journal',
    icon: JournalIcon,
    rail: 50,
    stands: 'graph',
    remembers: true,
    scoped: true,
  },
];

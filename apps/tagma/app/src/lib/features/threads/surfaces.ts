import { CHAT, type SurfacesModule } from '$lib/features/workspace/surface.js';
import AgentIcon from '$lib/shared/AgentIcon.svelte';

export const surfaces: SurfacesModule['surfaces'] = [
  {
    surface: CHAT,
    route: 'chat',
    label: 'Agents',
    icon: AgentIcon,
    rail: 10,
    pinned: true,
    home: true,
    stands: 'project',
    column: 'agents',
    remembers: true,
  },
];

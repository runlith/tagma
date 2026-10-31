import Bot from '@lucide/svelte/icons/bot';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Users from '@lucide/svelte/icons/users';
import type { SettingsSection } from '$lib/features/settings/section.js';
import AgentSection from '$lib/features/threads/AgentSection.svelte';
import SkillsSection from '$lib/features/threads/SkillsSection.svelte';
import TeamSection from '$lib/features/threads/team/TeamSection.svelte';

export const sections: readonly SettingsSection[] = [
  { id: 'agent', group: 'agent', order: 1, icon: Bot, view: AgentSection },
  {
    id: 'team',
    group: 'agent',
    order: 1.5,
    icon: Users,
    view: TeamSection,
    local: {
      title: 'Team',
      description:
        'Whether agents start agents, which models they run on and who reviews their work. The Team button in the composer changes the same things for one thread.',
    },
    keys: ['agent.delegation', 'agent.subAgentDepth', 'agent.models', 'agent.review'],
  },
  { id: 'threads', group: 'agent', order: 2, icon: MessagesSquare },
  { id: 'skills', group: 'agent', order: 3, icon: Sparkles, view: SkillsSection },
];

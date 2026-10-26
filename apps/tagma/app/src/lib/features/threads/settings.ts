import Bot from '@lucide/svelte/icons/bot';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import Sparkles from '@lucide/svelte/icons/sparkles';
import type { SettingsSection } from '$lib/features/settings/section.js';
import AgentSection from '$lib/features/threads/AgentSection.svelte';
import SkillsSection from '$lib/features/threads/SkillsSection.svelte';

export const sections: readonly SettingsSection[] = [
  { id: 'agent', group: 'agent', order: 1, icon: Bot, view: AgentSection },
  { id: 'threads', group: 'agent', order: 2, icon: MessagesSquare },
  { id: 'skills', group: 'agent', order: 3, icon: Sparkles, view: SkillsSection },
];

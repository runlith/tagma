import MemoryStick from '@lucide/svelte/icons/memory-stick';
import SquareTerminal from '@lucide/svelte/icons/square-terminal';
import Timer from '@lucide/svelte/icons/timer';
import TerminalSection from '$lib/features/executions/TerminalSection.svelte';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [
  { id: 'command', group: 'agent', order: 5, icon: Timer },
  { id: 'terminal', group: 'machine', order: 3, icon: SquareTerminal, view: TerminalSection },
  { id: 'host', group: 'machine', order: 4, icon: MemoryStick },
];

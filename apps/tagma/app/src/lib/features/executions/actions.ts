import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';
import type { PaletteActionList } from '$lib/features/workspace/action.js';
import TerminalIcon from './TerminalIcon.svelte';

export const actions: PaletteActionList = [
  {
    id: 'terminal.new',
    order: 20,
    title: 'New terminal beside',
    keywords: ['shell', 'console'],
    icon: TerminalIcon,
    available: (env) => env.routeProject !== null,
    run: async (env) => {
      await env.resolve(Terminals).openBeside();
    },
  },
];

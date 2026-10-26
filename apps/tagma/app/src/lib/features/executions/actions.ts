import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';
import type { ActionsModule } from '$lib/features/workspace/action.js';
import TerminalIcon from './TerminalIcon.svelte';

export const actions: ActionsModule['actions'] = [
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

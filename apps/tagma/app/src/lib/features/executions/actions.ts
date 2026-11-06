import { Terminals } from '$lib/features/executions/worktrees/Terminals.svelte.js';
import type { ActionList } from '$lib/features/workspace/action.js';
import { terminalActions, TOGGLE } from './terminal/actions.js';
import TerminalIcon from './TerminalIcon.svelte';

export const actions: ActionList = [
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
  {
    id: TOGGLE,
    order: 21,
    title: 'Show or hide terminals',
    keywords: ['shell', 'console', 'panel'],
    icon: TerminalIcon,
    keys: { mac: ['Mod+J'], other: ['Ctrl+Backquote', 'Ctrl+J'] },
    available: (env) => env.routeProject !== null,
    run: (env) => env.resolve(Terminals).toggle(),
  },
  ...terminalActions,
];

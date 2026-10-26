import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
import type { ActionsModule } from '$lib/features/workspace/action.js';
import { Outside } from './files/Outside.svelte.js';

export const actions: ActionsModule['actions'] = [
  {
    id: 'file.openIn',
    order: 50,
    title: 'Open current file in editor',
    keywords: ['open in', 'editor', 'external', 'vs code', 'cursor', 'zed', 'jetbrains', 'xcode'],
    icon: SquareArrowOutUpRight,
    available: (env) => {
      const outside = env.resolve(Outside);
      return outside.chosen !== null && outside.showing;
    },
    note: (env) => env.resolve(Outside).chosen?.name ?? null,
    run: (env) => {
      const outside = env.resolve(Outside);
      const file = outside.current();
      if (file !== null) return outside.open(file);
    },
  },
];

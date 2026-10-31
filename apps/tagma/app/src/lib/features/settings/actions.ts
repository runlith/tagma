import Settings2 from '@lucide/svelte/icons/settings-2';
import { Router } from '@runlith/layer/Router';
import type { PaletteActionList } from '$lib/features/workspace/action.js';
import { settingsHref } from '$lib/features/workspace/address.js';

export const actions: PaletteActionList = [
  {
    id: 'settings.open',
    order: 50,
    title: 'Settings',
    keywords: ['preferences', 'configuration'],
    icon: Settings2,
    run: (env) => env.goto(settingsHref(env.resolve(Router))),
  },
];

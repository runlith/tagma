import Globe from '@lucide/svelte/icons/globe';
import { Host } from '@runlith/layer/Host';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import type { ActionsModule } from '$lib/features/workspace/action.js';
import { browserPane } from './panes.js';

export const actions: ActionsModule['actions'] = [
  {
    id: 'browser.open',
    order: 36,
    title: 'Open the browser beside',
    keywords: ['browser', 'page', 'web', 'tab', 'url'],
    icon: Globe,
    available: (env) => env.routeProject !== null && env.resolve(Host).kind !== 'mobile',
    run: (env) => {
      env.resolve(SidePanes).open(browserPane(null));
    },
  },
];

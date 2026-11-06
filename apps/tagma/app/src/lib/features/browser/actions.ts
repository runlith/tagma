import Globe from '@lucide/svelte/icons/globe';
import { Host } from '@runlith/layer/Host';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import type { Action, ActionList } from '$lib/features/workspace/action.js';
import { browserPane } from './panes.js';

const page = (id: string, title: string, keys: readonly string[], tabKeys?: readonly string[]): Action => ({
  id,
  title,
  keys,
  ...(tabKeys === undefined ? {} : { tabKeys }),
});

export const actions: ActionList = [
  {
    id: 'browser.open',
    order: 36,
    title: 'Open the browser beside',
    keywords: ['browser', 'page', 'web', 'tab', 'url'],
    icon: Globe,
    keys: ['Mod+T'],
    tabKeys: [],
    available: (env) => env.routeProject !== null && env.resolve(Host).kind !== 'mobile',
    run: (env) => {
      env.resolve(SidePanes).open(browserPane(null));
    },
  },
  page('browser.address', 'Edit the page address', ['Mod+L'], []),
  page('browser.back', 'Go back in the page', ['Mod+BracketLeft']),
  page('browser.forward', 'Go forward in the page', ['Mod+BracketRight']),
  page('browser.reload', 'Reload the page', ['Mod+R'], []),
  page('browser.find', 'Find in the page', ['Mod+F']),
  page('page.zoom-in', 'Zoom the page in', ['Mod+Equal', 'Mod+Shift+Equal']),
  page('page.zoom-out', 'Zoom the page out', ['Mod+Minus']),
  page('page.zoom-reset', 'Show the page at actual size', ['Mod+0']),
  page('browser.stop-picking', 'Stop picking elements', ['Escape']),
];

import type { ActionList } from '$lib/features/workspace/action.js';

export const PAGES_MENU = 'pages-menu';

export const COPY_LINK = 'pages-menu.copy-link';

export const actions: ActionList = [
  { id: COPY_LINK, title: 'Copy the page’s link', region: PAGES_MENU, where: 'In the pages menu', keys: ['Mod+C'] },
];

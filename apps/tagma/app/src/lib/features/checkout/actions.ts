import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
import type { Action, ActionList } from '$lib/features/workspace/action.js';
import { COLUMN_ACTIONS, TAB_PLACES, tabPlace } from './files/keys.js';
import { Outside } from './files/Outside.svelte.js';

const served = (id: string, title: string, keys: readonly string[], tabKeys?: readonly string[]): Action => ({
  id,
  title,
  palette: false,
  keys,
  ...(tabKeys === undefined ? {} : { tabKeys }),
});

export const actions: ActionList = [
  {
    id: 'file.openIn',
    order: 50,
    title: 'Open current file in editor',
    keywords: ['open in', 'editor', 'external', 'vs code', 'cursor', 'zed', 'jetbrains', 'xcode'],
    icon: SquareArrowOutUpRight,
    keys: ['Mod+Alt+O'],
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
  served(COLUMN_ACTIONS.files, 'Show the files', ['Mod+Shift+E']),
  served(COLUMN_ACTIONS.search, 'Search in files', ['Mod+Shift+F']),
  served(COLUMN_ACTIONS.git, 'Show the changes', ['Mod+Shift+G']),
  served('tab.next', 'Go to the next tab', ['Ctrl+Tab', 'Mod+Shift+BracketRight'], ['Mod+Shift+BracketRight']),
  served('tab.previous', 'Go to the previous tab', ['Ctrl+Shift+Tab', 'Mod+Shift+BracketLeft'], ['Mod+Shift+BracketLeft']),
  ...Array.from({ length: TAB_PLACES }, (_, index) => served(tabPlace(index + 1), `Go to tab ${index + 1}`, [`Ctrl+${index + 1}`], [])),
  served('file.preview', 'Switch between the file and its preview', ['Mod+Shift+V']),
  served('file.keep', 'Keep the file open and save it', ['Mod+S']),
  served('file.wrap', 'Wrap long lines', ['Alt+Z']),
  served('file.copy-path', 'Copy the file path', ['Mod+Alt+C']),
];

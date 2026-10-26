import type { TerminalAppearance } from '../appearance/Settings.svelte.js';
import type { TerminalAct } from './Keymap.js';
import type { TerminalPane } from './Pane.svelte.js';

export function paneAct(act: TerminalAct, pane: TerminalPane, appearance: TerminalAppearance): boolean {
  switch (act._tag) {
    case 'copy':
      void pane.copy();
      return true;
    case 'paste':
      void pane.paste();
      return true;
    case 'select-all':
      pane.selectAll();
      return true;
    case 'search':
      pane.searching = !pane.searching;
      return true;
    case 'clear':
      pane.clear();
      return true;
    case 'scroll-top':
      pane.scrollTo('top');
      return true;
    case 'scroll-bottom':
      pane.scrollTo('bottom');
      return true;
    case 'zoom-in':
      appearance.zoom(pane, 1);
      return true;
    case 'zoom-out':
      appearance.zoom(pane, -1);
      return true;
    case 'zoom-reset':
      appearance.resetZoom(pane);
      return true;
    default:
      return false;
  }
}

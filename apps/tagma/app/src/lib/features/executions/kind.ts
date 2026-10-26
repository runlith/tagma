import type { PaneContent } from '$lib/shared/panes/pane.js';

export const TERMINAL_PANE = 'terminal';

export const terminalPane = (key: string): PaneContent => ({ kind: TERMINAL_PANE, id: key });

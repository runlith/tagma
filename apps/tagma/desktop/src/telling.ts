import { type BrowserWindow, dialog, type MessageBoxOptions } from 'electron';

export type Told = {
  readonly type: 'warning' | 'error';
  readonly message: string;
  readonly words: string;
  readonly details: string | null;
};

const shown = (window: BrowserWindow | undefined, options: MessageBoxOptions) =>
  window === undefined || window.isDestroyed() ? dialog.showMessageBox(options) : dialog.showMessageBox(window, options);

export async function tell(window: BrowserWindow | undefined, told: Told, report: () => void): Promise<void> {
  const buttons = told.details === null ? ['OK', 'Report a Problem…'] : ['OK', 'Report a Problem…', 'Details…'];
  for (;;) {
    const { response } = await shown(window, {
      type: told.type,
      message: told.message,
      detail: told.words,
      buttons,
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) report();
    if (response !== 2 || told.details === null) return;
    await shown(window, { type: 'info', message: 'Details', detail: told.details, buttons: ['Back'] });
  }
}

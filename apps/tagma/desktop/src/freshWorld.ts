import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { openFresh } from './server.js';
import { tell } from './telling.js';

export class FreshWorld {
  private opening = false;

  constructor(
    private readonly surface: URL,
    private readonly window: () => BrowserWindow | undefined,
    private readonly report: () => void,
  ) {}

  menu(): MenuItemConstructorOptions[] {
    return [
      { label: 'Open Fresh Tagma', click: () => void this.open(false) },
      { label: 'Start Fresh Tagma Over', click: () => void this.open(true) },
    ];
  }

  private async open(over: boolean): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      const refused = await openFresh(this.surface, over);
      if (refused === null) return;
      await tell(
        this.window(),
        { type: 'warning', message: 'The fresh Tagma did not open', words: refused.said ?? refused.reason, details: refused.reason },
        this.report,
      );
    } finally {
      this.opening = false;
    }
  }
}

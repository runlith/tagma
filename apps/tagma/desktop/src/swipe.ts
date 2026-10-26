import { createRequire } from 'node:module';
import type { BrowserWindow } from 'electron';
import type { SwipeDirection, SwipePhase } from './bridge.js';
import { SWIPE } from './channels.js';

export const SWIPE_ADDON = 'swipe.node';

type Native = {
  readonly watch: (listener: (phase: SwipePhase) => void) => void;
  readonly enabled: () => boolean;
};

const SIDES: Readonly<Record<string, SwipeDirection>> = { left: 'back', right: 'forward' };

export class Swipes {
  private readonly windows = new Set<BrowserWindow>();

  private constructor(private readonly native: Native) {
    native.watch((phase) => this.heard(phase));
  }

  static start(): Swipes | null {
    if (process.platform !== 'darwin') return null;
    return new Swipes(createRequire(import.meta.url)(`./${SWIPE_ADDON}`) as Native);
  }

  follow(window: BrowserWindow): void {
    this.windows.add(window);
    window.on('swipe', (_event, side: string) => {
      const direction = SIDES[side];
      if (direction !== undefined) window.webContents.send(SWIPE.swiped, direction);
    });
    window.on('closed', () => this.windows.delete(window));
  }

  private heard(phase: SwipePhase): void {
    if (phase === 'began' && !this.native.enabled()) return;
    for (const window of this.windows) window.webContents.send(SWIPE.phase, phase);
  }
}

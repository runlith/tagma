import { ipcMain, nativeTheme } from 'electron';
import type { NativeLook } from './bridge.js';
import { APPEARANCE } from './channels.js';
import type { Fronts } from './fronts.js';

const LOOKS: ReadonlySet<unknown> = new Set<NativeLook>(['system', 'light', 'dark']);

export class Appearance {
  constructor(private readonly fronts: Fronts) {}

  install(): void {
    ipcMain.on(APPEARANCE.follow, (event, look: unknown) => {
      if (!this.fronts.trusts(event.senderFrame?.url) || !LOOKS.has(look)) return;
      nativeTheme.themeSource = look as NativeLook;
    });
  }
}

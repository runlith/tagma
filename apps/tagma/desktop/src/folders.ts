import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import { FOLDERS } from './channels.js';

export class Folders {
  private place = homedir();

  constructor(private readonly surface: URL) {}

  install(): void {
    ipcMain.handle(FOLDERS.choose, (event) => (this.ours(event) ? this.choose(event) : null));
  }

  private ours(event: IpcMainInvokeEvent): boolean {
    const url = event.senderFrame?.url;
    return url !== undefined && URL.canParse(url) && new URL(url).origin === this.surface.origin;
  }

  private async choose(event: IpcMainInvokeEvent): Promise<string | null> {
    const window = BrowserWindow.fromWebContents(event.sender);
    const choosing: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose',
      defaultPath: this.place,
    };
    const chosen = window === null ? await dialog.showOpenDialog(choosing) : await dialog.showOpenDialog(window, choosing);
    const folder = chosen.canceled ? null : (chosen.filePaths[0] ?? null);
    if (folder !== null) this.place = dirname(folder);
    return folder;
  }
}

import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, type WebContents } from 'electron';
import type { BrowserIdentity, Chord, FramedChord, Identities, PageRect, PageShown } from '../bridge.js';
import { BROWSER } from '../channels.js';
import type { Fronts } from '../fronts.js';
import type { BrowserHost } from './host.js';
import { chooseIdentity, chosenIdentity } from './identity.js';

const ZOOM = { least: 0.25, most: 5 } as const;

const FRAME_QUALITY = 90;

const isRect = (value: unknown): value is PageRect => {
  const rect = value as Partial<PageRect> | null;
  return [rect?.x, rect?.y, rect?.width, rect?.height].every((number) => typeof number === 'number' && Number.isFinite(number));
};

const isShown = (value: unknown): value is PageShown => {
  const shown = value as Partial<PageShown> | null;
  return typeof shown?.page === 'string' && typeof shown.panel === 'string';
};

const isChord = (value: unknown): value is Chord => {
  const chord = value as Partial<Chord> | null;
  return typeof chord?.code === 'string' && [chord.meta, chord.ctrl, chord.alt, chord.shift].every((flag) => typeof flag === 'boolean');
};

const isFramed = (value: unknown): value is FramedChord => {
  const framed = value as Partial<FramedChord> | null;
  return isChord(framed?.chord) && typeof framed?.frame === 'string' && framed.frame !== '';
};

export class Panels {
  private readonly found = new WeakMap<WebContents, string>();

  constructor(
    private readonly fronts: Fronts,
    private readonly host: BrowserHost,
    private readonly hostId: string,
    private readonly userData: string,
    private readonly applied: BrowserIdentity,
  ) {}

  install(): void {
    ipcMain.handle(BROWSER.host, (event) => (this.ours(event) ? this.hostId : null));
    ipcMain.handle(BROWSER.identity, (event): Identities | null =>
      this.ours(event) ? { applied: this.applied, chosen: chosenIdentity(this.userData) } : null,
    );
    ipcMain.on(BROWSER.chooseIdentity, (event, identity: unknown) => {
      if (this.ours(event) && (identity === 'cleaned' || identity === 'native')) chooseIdentity(this.userData, identity);
    });
    ipcMain.on(BROWSER.show, (event, shown: unknown, rect: unknown) => {
      const window = this.window(event);
      const held = window === null || !isShown(shown) || !isRect(rect) ? undefined : this.host.page(shown.page);
      if (window !== null && held !== undefined)
        this.host.placement.show(held.placed, window, (shown as PageShown).panel, rect as PageRect);
    });
    ipcMain.on(BROWSER.hide, (event, shown: unknown) => {
      const window = this.window(event);
      const held = window === null || !isShown(shown) ? undefined : this.host.page(shown.page);
      if (window !== null && held !== undefined) this.host.placement.hide(held.placed, window, (shown as PageShown).panel);
    });
    ipcMain.on(BROWSER.freeze, (event, shown: unknown, frozen: unknown) => {
      const window = this.window(event);
      const held = window === null || !isShown(shown) || typeof frozen !== 'boolean' ? undefined : this.host.page(shown.page);
      if (window !== null && held !== undefined)
        this.host.placement.freeze(held.placed, window, (shown as PageShown).panel, frozen as boolean);
    });
    ipcMain.on(BROWSER.keys, (event, chords: unknown, framed: unknown) => {
      if (!this.ours(event) || !Array.isArray(chords) || !chords.every(isChord)) return;
      this.host.keys(event.sender, chords, Array.isArray(framed) && framed.every(isFramed) ? framed : []);
    });
    ipcMain.on(BROWSER.find, (event, page: unknown, text: unknown, forward: unknown) => {
      const held = this.pageOf(event, page);
      if (held === undefined || typeof text !== 'string' || text === '') return;
      const fresh = this.found.get(held.contents) !== text;
      this.found.set(held.contents, text);
      held.contents.findInPage(text, { forward: forward !== false, findNext: fresh });
    });
    ipcMain.on(BROWSER.stopFind, (event, page: unknown) => {
      const held = this.pageOf(event, page);
      if (held === undefined) return;
      this.found.delete(held.contents);
      held.contents.stopFindInPage('clearSelection');
    });
    ipcMain.on(BROWSER.zoom, (event, page: unknown, factor: unknown) => {
      const held = this.pageOf(event, page);
      if (held !== undefined && typeof factor === 'number' && Number.isFinite(factor)) {
        held.contents.setZoomFactor(Math.min(ZOOM.most, Math.max(ZOOM.least, factor)));
      }
    });
    ipcMain.on(BROWSER.devtools, (event, page: unknown) => {
      const held = this.pageOf(event, page);
      if (held === undefined) return;
      if (held.contents.isDevToolsOpened()) held.contents.closeDevTools();
      else held.contents.openDevTools({ mode: 'detach' });
    });
    ipcMain.handle(BROWSER.capture, async (event, page: unknown): Promise<string | null> => {
      const held = this.pageOf(event, page);
      if (held === undefined || held.contents.isDestroyed()) return null;
      const image = await held.contents.capturePage();
      return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(FRAME_QUALITY).toString('base64')}`;
    });
  }

  private ours(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return this.fronts.trusts(event.senderFrame?.url);
  }

  private window(event: IpcMainEvent): BrowserWindow | null {
    return this.ours(event) ? BrowserWindow.fromWebContents(event.sender) : null;
  }

  private pageOf(event: IpcMainEvent | IpcMainInvokeEvent, page: unknown) {
    return this.ours(event) && typeof page === 'string' ? this.host.page(page) : undefined;
  }
}

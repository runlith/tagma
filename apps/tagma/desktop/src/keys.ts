import { BrowserWindow, type Input, type WebContents, ipcMain } from 'electron';
import type { GlobalKey, KeyPress, WindowKeys } from './bridge.js';
import { KEYS } from './channels.js';
import type { Fronts } from './fronts.js';
import type { Globals } from './globals.js';
import { chordOfInput } from './inputChord.js';
import { intercepted, type Table, tableOf } from './interception.js';

export interface KeyFollower {
  follow(contents: WebContents): void;
}

const strings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((one) => typeof one === 'string');

const isFramed = (value: unknown): value is WindowKeys['framed'][number] => {
  const framed = value as Partial<WindowKeys['framed'][number]> | null;
  return typeof framed?.chord === 'string' && typeof framed.frame === 'string' && framed.frame !== '';
};

const isGlobal = (value: unknown): value is GlobalKey => {
  const key = value as Partial<GlobalKey> | null;
  return typeof key?.chord === 'string' && typeof key.action === 'string' && typeof key.hold === 'boolean';
};

const decoded = (value: unknown): WindowKeys | null => {
  const keys = value as Partial<Record<keyof WindowKeys, unknown>> | null;
  if (keys === null || typeof keys !== 'object') return null;
  const { chords, claimed, framed, global } = keys;
  return strings(chords) &&
    strings(claimed) &&
    Array.isArray(framed) &&
    framed.every(isFramed) &&
    Array.isArray(global) &&
    global.every(isGlobal)
    ? { chords, claimed, framed, global }
    : null;
};

export class Keys implements KeyFollower {
  private readonly tables = new WeakMap<WebContents, Table>();
  private readonly mac = process.platform === 'darwin';

  constructor(
    private readonly fronts: Fronts,
    private readonly globals: Globals,
    private readonly menu: () => ReadonlySet<string>,
    private readonly kept: () => readonly string[],
    private readonly published: (contents: WebContents) => void,
  ) {}

  install(): void {
    ipcMain.on(KEYS.publish, (event, value: unknown) => {
      const keys = decoded(value);
      if (keys === null || !this.fronts.trusts(event.senderFrame?.url)) return;
      this.tables.set(event.sender, tableOf(keys));
      this.globals.set(keys.global);
      this.published(event.sender);
    });
    ipcMain.handle(KEYS.kept, (event) => (this.fronts.trusts(event.senderFrame?.url) ? this.kept() : []));
    ipcMain.handle(KEYS.answers, (event) => (this.fronts.trusts(event.senderFrame?.url) ? this.globals.answers() : []));
    ipcMain.handle(KEYS.owned, (event) => (this.fronts.trusts(event.senderFrame?.url) ? this.globals.owned() : []));
    ipcMain.on(KEYS.perform, (event, action: unknown) => {
      if (typeof action === 'string' && this.fronts.trusts(event.senderFrame?.url)) this.globals.perform(action);
    });
    this.globals.onAnswers((answers) => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(KEYS.answered, answers);
    });
  }

  follow(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      const table = this.tables.get(contents);
      const chord = table === undefined || input.type !== 'keyDown' ? null : chordOfInput(input, this.mac);
      if (table === undefined || chord === null) return;
      const focused = contents.focusedFrame;
      const frame = focused === null || focused.frameTreeNodeId === contents.mainFrame.frameTreeNodeId ? null : focused.url;
      const press = intercepted(chord, frame, table, this.menu());
      if (press === null) return;
      event.preventDefault();
      contents.send(KEYS.press, press);
    });
  }

  page(window: WebContents, page: string, input: Input): boolean {
    const chord = chordOfInput(input, this.mac);
    if (chord === null || this.tables.get(window)?.chords.has(chord) !== true) return false;
    window.send(KEYS.press, { chord, page, frame: null, global: false } satisfies KeyPress);
    return true;
  }
}

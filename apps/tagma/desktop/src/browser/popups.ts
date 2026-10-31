import { BaseWindow, WebContentsView } from 'electron';
import type { HeldPage } from './page.js';

const BAR = 34;
const SIZE = { width: 800, height: 600 } as const;
const MINIMUM = { width: 360, height: 200 } as const;

const escaped = (text: string): string => text.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

const barPage = (url: string): string => {
  const origin = URL.canParse(url) ? new URL(url).origin : url;
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><body style="margin:0;height:${BAR}px;display:flex;align-items:center;padding:0 12px;font:13px system-ui,sans-serif;background:#f3f3f3;color:#222;border-bottom:1px solid #ddd;user-select:none;-webkit-app-region:drag">${escaped(origin)}</body></html>`,
  )}`;
};

export type PopupSize = { readonly width?: number; readonly height?: number; readonly x?: number; readonly y?: number };

export const showPopup = (page: HeldPage, size: PopupSize, settle: () => void, reveal: (window: BaseWindow) => void): BaseWindow => {
  const width = Math.max(MINIMUM.width, size.width ?? SIZE.width);
  const height = Math.max(MINIMUM.height, size.height ?? SIZE.height);
  const window = new BaseWindow({ width, height: height + BAR, minWidth: MINIMUM.width, minHeight: MINIMUM.height + BAR, show: false });
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  window.contentView.addChildView(bar);
  page.placed.home = {
    window,
    bounds: () => {
      const bounds = window.getContentBounds();
      return { x: 0, y: BAR, width: bounds.width, height: Math.max(0, bounds.height - BAR) };
    },
  };
  const lay = () => {
    bar.setBounds({ x: 0, y: 0, width: window.getContentBounds().width, height: BAR });
    settle();
  };
  const told = (url: string) => {
    if (!bar.webContents.isDestroyed()) bar.webContents.loadURL(barPage(url)).catch(() => undefined);
  };
  lay();
  told(page.contents.getURL());
  window.on('resize', lay);
  for (const name of ['show', 'hide', 'minimize', 'restore'] as const) window.on(name as 'show', settle);
  page.contents.on('did-navigate', (_event, url) => told(url));
  page.contents.once('destroyed', () => {
    if (!window.isDestroyed()) window.destroy();
  });
  window.on('closed', () => {
    bar.webContents.close();
    if (!page.contents.isDestroyed()) page.contents.close();
  });
  reveal(window);
  return window;
};

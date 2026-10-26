import { type BaseWindow, type ContextMenuParams, Menu, type MenuItemConstructorOptions, shell, type WebContents } from 'electron';
import { allowedUrl } from './page.js';

export type MenuActs = {
  readonly openTab: (url: string) => void;
};

export const pageMenu = (contents: WebContents, params: ContextMenuParams, acts: MenuActs): MenuItemConstructorOptions[] => {
  const items: MenuItemConstructorOptions[] = [];
  const link = params.linkURL;
  if (link !== '' && allowedUrl(link)) {
    items.push(
      { label: 'Open Link in New Tab', click: () => acts.openTab(link) },
      { label: 'Open Link in System Browser', click: () => void shell.openExternal(link) },
      { type: 'separator' },
    );
  }
  if (params.mediaType === 'image' && params.srcURL !== '') {
    items.push({ label: 'Save Image As…', click: () => contents.downloadURL(params.srcURL) }, { type: 'separator' });
  }
  if (params.isEditable || params.selectionText !== '') items.push({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy });
  if (params.isEditable) items.push({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste });
  if (items.length > 0 && items.at(-1)?.type !== 'separator') items.push({ type: 'separator' });
  items.push({ label: 'Inspect Element', click: () => contents.inspectElement(params.x, params.y) });
  return items;
};

export const showPageMenu = (window: BaseWindow, contents: WebContents, params: ContextMenuParams, acts: MenuActs): void => {
  Menu.buildFromTemplate(pageMenu(contents, params, acts)).popup({ window });
};

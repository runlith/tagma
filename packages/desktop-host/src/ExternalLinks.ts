import type { WebContents } from 'electron';
import { shell } from 'electron';

const SYSTEM_SETTINGS = 'x-apple.systempreferences:';

export function installExternalLinks(input: {
  readonly appOrigins: readonly string[];
  readonly page: (url: URL) => boolean;
  readonly webContents: WebContents;
}): void {
  const own = (url: string): boolean => {
    const origin = originFor(url);
    return origin !== null && input.appOrigins.includes(origin);
  };
  input.webContents.setWindowOpenHandler(({ url }) => {
    if (own(url) && input.page(new URL(url))) return { action: 'deny' };
    if (isHttpUrl(url) || protocolFor(url) === SYSTEM_SETTINGS) {
      void openInDefaultBrowser(url);
      return { action: 'deny' };
    }
    if (url.startsWith('data:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    return { action: 'deny' };
  });

  input.webContents.on('will-navigate', (event, url) => {
    if (own(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) void openInDefaultBrowser(url);
  });
}

async function openInDefaultBrowser(url: string): Promise<void> {
  try {
    await shell.openExternal(url);
  } catch (caught) {
    console.warn('[external-links] The default browser did not open a link:', caught);
  }
}

function isHttpUrl(url: string): boolean {
  const protocol = protocolFor(url);
  return protocol === 'http:' || protocol === 'https:';
}

function protocolFor(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

function originFor(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

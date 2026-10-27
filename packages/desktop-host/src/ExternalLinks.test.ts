import type { WebContents } from 'electron';
import { shell } from 'electron';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installExternalLinks } from './ExternalLinks';

const APP_ORIGIN = 'http://localhost:5193';
const API_ORIGIN = 'http://127.0.0.1:8791';

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

type OpenHandler = (details: { url: string }) => { action: string };
type NavigateHandler = (event: { preventDefault: () => void }, url: string) => void;

function install(): { open: OpenHandler; navigate: NavigateHandler } {
  let open: OpenHandler | undefined;
  let navigate: NavigateHandler | undefined;
  const webContents = {
    setWindowOpenHandler: (handler: OpenHandler) => {
      open = handler;
    },
    on: (event: string, handler: NavigateHandler) => {
      if (event === 'will-navigate') navigate = handler;
    },
  } as unknown as WebContents;
  installExternalLinks({ appOrigins: () => [APP_ORIGIN, API_ORIGIN], page: (url) => !url.pathname.startsWith('/api/'), webContents });
  if (!open || !navigate) throw new Error('External-link handlers were not installed.');
  return { open, navigate };
}

describe('installExternalLinks', () => {
  test('sends external links to the default browser instead of a child window', () => {
    vi.spyOn(shell, 'openExternal').mockResolvedValue(undefined);
    const { open } = install();

    expect(open({ url: 'https://auth.openai.com/authorize?x=1' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://auth.openai.com/authorize?x=1');
  });

  test('keeps a window opened on a page of the app out of the default browser, and sends its resources there', () => {
    vi.spyOn(shell, 'openExternal').mockResolvedValue(undefined);
    const { open } = install();

    expect(open({ url: `${APP_ORIGIN}/runlith/b/db391956` })).toEqual({ action: 'deny' });
    expect(open({ url: `${APP_ORIGIN}/api/threads/t1/attachments/a1` })).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(`${APP_ORIGIN}/api/threads/t1/attachments/a1`);
  });

  test('keeps data-url previews in a hardened child window', () => {
    const { open } = install();

    const response = open({ url: 'data:image/png;base64,AAAA' });
    expect(response).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      },
    });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('denies non-http schemes without opening anything', () => {
    const { open } = install();

    expect(open({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('escapes a main-frame navigation to a foreign origin into the default browser', () => {
    vi.spyOn(shell, 'openExternal').mockResolvedValue(undefined);
    const { navigate } = install();
    const preventDefault = vi.fn();

    navigate({ preventDefault }, 'https://example.com/page');
    expect(preventDefault).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page');
  });

  test('lets the main frame navigate within the app origins', () => {
    const { navigate } = install();
    const preventDefault = vi.fn();

    navigate({ preventDefault }, `${APP_ORIGIN}/notes`);
    navigate({ preventDefault }, `${API_ORIGIN}/api/auth/callback`);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

import { beforeEach, expect, mock, test } from 'bun:test';

type Details = { readonly isMainFrame: boolean; readonly requestingUrl: string; readonly mediaTypes?: readonly string[] };
type Request = (contents: unknown, permission: string, callback: (granted: boolean) => void, details: Details) => void;
type Check = (contents: unknown, permission: string, origin: string, details: { isMainFrame: boolean; mediaType?: string }) => boolean;

const asked: string[] = [];
const dialogs: unknown[] = [];
const answers: number[] = [];

mock.module('electron', () => ({
  dialog: {
    showMessageBox: async (window: unknown) => {
      dialogs.push(window);
      return { response: answers.shift() ?? 1 };
    },
  },
  systemPreferences: {
    getMediaAccessStatus: () => 'not-determined',
    askForMediaAccess: async (device: string) => {
      asked.push(device);
      return true;
    },
  },
}));

const { MediaGrants } = await import('./mediaGrants.js');

const window = { shown: true, isDestroyed: () => false, isVisible: () => window.shown, isMinimized: () => false };
const contents = {};
const site = 'https://meet.example/room';

const guarded = () => {
  let request: Request | undefined;
  let check: Check | undefined;
  new MediaGrants(() => window as never).guardFrames({
    setPermissionRequestHandler: (handler: Request) => void (request = handler),
    setPermissionCheckHandler: (handler: Check) => void (check = handler),
  } as never);
  return {
    ask: (permission: string, details: Details) => new Promise<boolean>((done) => request!(contents, permission, done, details)),
    check: (origin: string, mediaType: string, isMainFrame = false) => check!(contents, 'media', origin, { isMainFrame, mediaType }),
    other: (permission: string, isMainFrame: boolean) => check!(contents, permission, site, { isMainFrame }),
  };
};

const microphone: Details = { isMainFrame: false, requestingUrl: site, mediaTypes: ['audio'] };

beforeEach(() => {
  asked.length = 0;
  dialogs.length = 0;
  answers.length = 0;
  window.shown = true;
});

test('a framed site gets the microphone only after the person allows its origin in a shown window, then the system is asked', async () => {
  const session = guarded();
  expect(session.check('https://meet.example', 'audio')).toBe(false);
  answers.push(0);
  expect(await session.ask('media', microphone)).toBe(true);
  expect(dialogs).toEqual([window]);
  expect(asked).toEqual(process.platform === 'darwin' ? ['microphone'] : []);
  expect(session.check('https://meet.example', 'audio')).toBe(true);
  expect(session.check('https://meet.example', 'video')).toBe(false);
  expect(session.check('https://other.example', 'audio')).toBe(false);
  expect(await session.ask('media', microphone)).toBe(true);
  expect(dialogs).toHaveLength(1);
});

test('a blocked or unshown framed site is denied and the system is not asked', async () => {
  const session = guarded();
  answers.push(1);
  expect(await session.ask('media', microphone)).toBe(false);
  expect(asked).toEqual([]);
  expect(session.check('https://meet.example', 'audio')).toBe(false);

  const other = guarded();
  answers.push(0);
  expect(await other.ask('media', { ...microphone, requestingUrl: 'https://allowed.example/' })).toBe(true);
  window.shown = false;
  dialogs.length = 0;
  expect(other.check('https://allowed.example', 'audio')).toBe(false);
  expect(await other.ask('media', { ...microphone, requestingUrl: 'https://hidden.example/' })).toBe(false);
  expect(dialogs).toEqual([]);
});

test("the window's own page and every other permission keep today's answer", async () => {
  const session = guarded();
  expect(await session.ask('media', { ...microphone, isMainFrame: true, requestingUrl: 'http://127.0.0.1:4000/' })).toBe(true);
  expect(await session.ask('fullscreen', { isMainFrame: false, requestingUrl: site })).toBe(true);
  expect(session.check('http://127.0.0.1:4000', 'audio', true)).toBe(true);
  expect(session.other('notifications', false)).toBe(true);
  expect(dialogs).toEqual([]);
  expect(asked).toEqual([]);
});

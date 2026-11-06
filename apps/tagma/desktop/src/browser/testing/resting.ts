import './guard.js';
import { once } from 'node:events';
import type { PageId, ProfileId } from '@tagma/server/browser/contract/wire/ids';
import type { Call } from '@tagma/server/desktop-browser/contract/wire/channel';
import { app } from 'electron';
import { BrowserHost } from '../host.js';
import { UNOCCLUDED } from '../placement.js';
import { Profiles } from '../profiles.js';

const PROFILE = 'rest' as ProfileId;
const PAGE = 'page-1' as PageId;

const became = (want: 'hidden' | 'visible') => `new Promise((done) => {
  const reached = () => (${JSON.stringify(want)} === 'visible' ? requestAnimationFrame(() => done(document.visibilityState)) : done(document.visibilityState));
  if (document.visibilityState === ${JSON.stringify(want)}) return reached();
  const seen = () => {
    if (document.visibilityState !== ${JSON.stringify(want)}) return;
    document.removeEventListener('visibilitychange', seen);
    reached();
  };
  document.addEventListener('visibilitychange', seen);
})`;

const data = process.env.BROWSER_DATA;
if (data === undefined) throw new Error('BROWSER_DATA names the data folder');
app.setPath('userData', data);
app.commandLine.appendSwitch(UNOCCLUDED);
app.commandLine.appendSwitch('use-mock-keychain');
if (process.platform === 'darwin') app.setActivationPolicy('accessory');

void app.whenReady().then(async () => {
  let host: BrowserHost | undefined;
  const profiles = new Profiles('cleaned', { downloaded: () => undefined, window: (contents) => host?.window(contents) ?? null });
  const served = new BrowserHost(profiles, 'cleaned', { newWindow: () => undefined, reveal: () => undefined, pressed: () => false });
  host = served;
  profiles
    .session(PROFILE)
    .protocol.handle('https', () => new Response('<!doctype html><title>rest</title>', { headers: { 'content-type': 'text/html' } }));
  const waiting = new Map<number, { readonly done: (value: unknown) => void; readonly fail: (error: Error) => void }>();
  let asked = 0;
  served.attach({
    answer: (id, value) => waiting.get(id)?.done(value),
    fail: (id, failure) => waiting.get(id)?.fail(new Error(failure.message)),
    bytes: () => undefined,
    event: () => undefined,
    blocked: () => undefined,
    cdp: () => undefined,
    ended: () => undefined,
  });
  const call = (body: Call) =>
    new Promise((done, fail) => {
      const id = ++asked;
      waiting.set(id, { done, fail });
      served.call(id, body);
    });
  const contents = () => served.page(PAGE)!.contents;
  const seen: Record<string, unknown> = {};
  const observe = async (step: string, want: 'hidden' | 'visible') => {
    seen[step] = await contents().executeJavaScript(became(want));
  };
  await call({ kind: 'open', page: PAGE, profile: PROFILE, context: null, url: 'https://fixture.invalid/', history: null, policy: null });
  await observe('unseen', 'hidden');
  await call({ kind: 'paint', page: PAGE, hold: 1 });
  await observe('held', 'visible');
  await call({ kind: 'unpaint', hold: 1 });
  await observe('released', 'hidden');
  const gone = once(contents(), 'render-process-gone');
  contents().forcefullyCrashRenderer();
  await gone;
  const loaded = once(contents(), 'did-stop-loading');
  contents().reload();
  await loaded;
  await observe('restarted', 'hidden');
  await call({ kind: 'session', page: PAGE, session: 1 });
  await observe('driven', 'visible');
  await call({ kind: 'unsession', session: 1 });
  await observe('undriven', 'hidden');
  process.stdout.write(`${JSON.stringify(seen)}\n`);
  app.exit(0);
});

import './guard.js';
import type { Call } from '@tagma/server/desktop-browser/contract/wire/channel';
import type { WindowDeclaration } from '@tagma/server/executions/contract/wire/load';
import { viewFrameName } from '@tagma/server/executions/contract/wire/viewName';
import { app, BrowserWindow, session } from 'electron';
import { Declaring } from '../../declaring.js';
import { BrowserHost } from '../host.js';
import { UNOCCLUDED } from '../placement.js';
import { Profiles } from '../profiles.js';

const PROFILE = 'declaring';
const VIEW = viewFrameName({ _tag: 'AppView', project: 1, app: 'notes', view: 'board' });
const SURFACE = `data:text/html,${encodeURIComponent(`<title>surface</title><iframe name='${VIEW}' src='https://viewer.invalid/'></iframe>`)}`;
const PAGE = `<!doctype html><title>busy</title>
<script>const spin = () => { const end = performance.now() + 40; while (performance.now() < end); setTimeout(spin, 0); }; spin();</script>
<iframe src="https://elsewhere.invalid/"></iframe>`;
const FRAME = '<!doctype html><title>elsewhere</title>';
const VIEWER = '<!doctype html><title>viewer</title><iframe src="https://nested.invalid/"></iframe>';

app.commandLine.appendSwitch(UNOCCLUDED);
if (process.platform === 'darwin') app.setActivationPolicy('accessory');

void app.whenReady().then(async () => {
  let host: BrowserHost | undefined;
  const profiles = new Profiles('cleaned', { downloaded: () => undefined, window: (contents) => host?.window(contents) ?? null });
  const served = new BrowserHost(profiles, 'cleaned', { newWindow: () => undefined, reveal: () => undefined });
  host = served;
  const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });
  profiles.session(PROFILE).protocol.handle('https', (request) => html(new URL(request.url).hostname === 'fixture.invalid' ? PAGE : FRAME));
  session.defaultSession.protocol.handle('https', (request) => html(new URL(request.url).hostname === 'viewer.invalid' ? VIEWER : FRAME));
  const declarations: WindowDeclaration[] = [];
  const waiting: (() => void)[] = [];
  const waitingCalls = new Map<number, { readonly done: (value: unknown) => void; readonly fail: (error: Error) => void }>();
  let asked = 0;
  served.attach({
    answer: (id, value) => waitingCalls.get(id)?.done(value),
    fail: (id, failure) => waitingCalls.get(id)?.fail(new Error(failure.message)),
    bytes: () => undefined,
    event: () => undefined,
    blocked: () => undefined,
    cdp: () => undefined,
    ended: () => undefined,
  });
  const declarer = new Declaring(served, (url) => url.startsWith('data:text/html,'));
  declarer.install();
  const surface = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await surface.loadURL(SURFACE);
  declarer.attach({
    declare: (declaration) => {
      declarations.push(declaration);
      for (const done of waiting.splice(0)) done();
    },
  });
  Object.assign(globalThis, {
    declaring: {
      profile: PROFILE,
      call: (call: Call) =>
        new Promise((done, fail) => {
          const id = ++asked;
          waitingCalls.set(id, { done, fail });
          served.call(id, call);
        }),
      nestedPid: () =>
        surface.webContents.mainFrame.framesInSubtree.find((frame) => frame.origin === 'https://nested.invalid')?.osProcessId ?? null,
      next: (seen: number) =>
        new Promise<readonly WindowDeclaration[]>((done) => {
          if (declarations.length > seen) done(declarations);
          else waiting.push(() => done(declarations));
        }),
    },
  });
});

import './guard.js';
import { createInterface } from 'node:readline';
import { app, BrowserWindow } from 'electron';
import { Effect } from 'effect';
import { Declaring } from '../../declaring.js';
import { serveHost } from '../connection.js';
import { BrowserHost } from '../host.js';
import { cleanedAgent, hostIdIn } from '../identity.js';
import { UNOCCLUDED } from '../placement.js';
import { Profiles } from '../profiles.js';

const SERVER_ENV = 'TAGMA_TEST_BROWSER_SERVER';
const DATA_ENV = 'TAGMA_TEST_BROWSER_DATA';
const SURFACE = 'data:text/html,<title>surface</title>';

type Command = { readonly id: number; readonly show?: string; readonly reload?: true; readonly nativeProbe?: string };

const server = process.env[SERVER_ENV];
const data = process.env[DATA_ENV];
if (server === undefined || data === undefined) throw new Error(`${SERVER_ENV} and ${DATA_ENV} name the server and the data folder`);

app.setPath('userData', data);
app.userAgentFallback = cleanedAgent(app.userAgentFallback);
app.commandLine.appendSwitch(UNOCCLUDED);
app.commandLine.appendSwitch('use-mock-keychain');
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
app.on('window-all-closed', () => undefined);

void app.whenReady().then(() => {
  let host: BrowserHost | undefined;
  const profiles = new Profiles('cleaned', {
    downloaded: (contents, download) => host?.downloaded(contents, download),
    window: (contents) => host?.window(contents) ?? null,
  });
  const served = new BrowserHost(profiles, 'cleaned', { newWindow: () => undefined, reveal: () => undefined });
  host = served;
  const surface = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, contextIsolation: true } });
  void surface.loadURL(SURFACE);
  createInterface({ input: process.stdin }).on('line', (line) => {
    void (async () => {
      const command = JSON.parse(line) as Command;
      const page = command.show === undefined ? undefined : served.page(command.show);
      if (page !== undefined) served.placement.show(page.placed, surface, 'panel', { x: 0, y: 0, width: 900, height: 700 });
      if (command.reload === true) surface.webContents.reload();
      if (command.nativeProbe !== undefined) {
        const held = served.page(command.nativeProbe);
        if (held === undefined) throw new Error('the native probe page closed');
        const root = held.contents.mainFrame;
        const pid = root.osProcessId;
        const child = root.framesInSubtree.find((frame) => !frame.isDestroyed() && frame.osProcessId > 0 && frame.osProcessId !== pid);
        if (child === undefined) throw new Error('the probe requires a distinct child renderer');
        const metric = app.getAppMetrics().find((process) => process.pid === pid);
        if (metric === undefined) throw new Error('the root renderer has no CPU identity');
        const process = `${pid}/${metric.creationTime}`;
        held.contents.emit('unresponsive');
        held.sample({ process, millis: 0 });
        await root.executeJavaScript('0');
        held.sample({ process, millis: 6_000 });
        await root.executeJavaScript("document.title = 'native-probe-fenced'; true");
      }
      process.stdout.write(`${JSON.stringify({ done: command.id })}\n`);
    })();
  });
  const declarer = new Declaring(served, (url) => url === SURFACE);
  declarer.install();
  Effect.runFork(serveHost({ surface: new URL(server), ours: async () => true, host: hostIdIn(data), executor: served, declarer }));
});

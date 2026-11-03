import '../browser/testing/guard.js';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { Fronts } from '../fronts.js';
import { ProjectWindows } from '../projectWindows.js';
import { SurfaceLoader } from '../SurfaceLoader.js';

if (process.platform === 'darwin') app.setActivationPolicy('accessory');
app.on('browser-window-created', (_event, window) => {
  window.show = () => undefined;
  window.showInactive = () => undefined;
});

void app.whenReady().then(async () => {
  let build = 'first';
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'public, max-age=86400' });
    response.end(`<!doctype html><title>${build}</title><p id="build">${build}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  app.on('will-quit', () => server.close());
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the surface has no TCP address');
  const url = new URL(`http://127.0.0.1:${address.port}/project/chat?branch=main`);
  const fronts = new Fronts(url);
  let windows: ProjectWindows;
  const loader = new SurfaceLoader(
    url,
    { executable: app.getPath('exe'), env: {}, named: true },
    {
      open: () => windows.open(),
      show: (state) => windows.show(state),
      offer: async () => false,
      ask: async () => false,
      told: () => undefined,
      reopen: () => undefined,
      settled: () => undefined,
      fell: async () => 'left',
    },
  );
  windows = new ProjectWindows(fronts, '', join(app.getPath('userData'), 'placement.json'), loader, null, () => undefined, null);
  Object.assign(globalThis, {
    surfaceCache: {
      url: url.toString(),
      replace: () => void (build = 'second'),
      open: () => windows.create(url).id,
    },
  });
  const primer = new BrowserWindow({ show: false });
  await primer.loadURL('about:blank');
});

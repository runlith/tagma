import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = (file: string): string => JSON.stringify(fileURLToPath(new URL(file, import.meta.url)));

const fixture = `
import { once } from 'node:events';
import { app, BaseWindow } from 'electron';
import { HeldPage } from ${source('./page.ts')};
import { RendererStrain } from ${source('./strain.ts')};
import { cleanedAgent, firefoxAgent } from ${source('./identity.ts')};
import { Profiles } from ${source('./profiles.ts')};

app.setPath('userData', process.env.BROWSER_DATA);
app.userAgentFallback = cleanedAgent(app.userAgentFallback);
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess');
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
void app.whenReady().then(async () => {
  const window = new BaseWindow({ show: false });
  const profiles = new Profiles('cleaned', { downloaded: () => undefined, window: () => window });
  const held = profiles.session('redirect');
  const requests = [];
  held.protocol.handle('https', (request) => {
    requests.push(request.url);
    const url = new URL(request.url);
    if (url.pathname === '/enter') return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/finish' } });
    if (url.pathname === '/leave') return new Response(null, { status: 302, headers: { location: 'https://fixture.invalid/complete' } });
    return new Response('<!doctype html><p>complete</p>', { headers: { 'content-type': 'text/html' } });
  });
  const page = HeldPage.create('redirect', null, 'redirect', null, 'cleaned', new RendererStrain(), { event: () => undefined, closed: () => undefined, window: () => window, navigation: () => undefined, blocked: () => undefined, revision: () => 0 });
  window.contentView.addChildView(page.view);
  const visit = async (url) => {
    const stopped = once(page.contents, 'did-stop-loading');
    page.load(url, null);
    await stopped;
    for (;;) {
      const observed = await page.contents.executeJavaScript('({ url: location.href, agent: navigator.userAgent, text: document.body.textContent })');
      if (observed.agent === page.contents.getUserAgent()) return observed;
    }
  };
  const google = await visit('https://fixture.invalid/enter');
  const external = await visit('https://accounts.google.com/leave');
  console.log(JSON.stringify({ google, external, requests, firefox: firefoxAgent(), normal: held.getUserAgent(), debugger: page.contents.debugger.isAttached() }));
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
`;

test('redirects into and out of sign-in preserve the final document and identity without replaying navigation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desktop-identity-'));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const entry = join(home, 'fixture.ts');
    await writeFile(entry, fixture);
    const built = await Bun.build({ entrypoints: [entry], target: 'node', format: 'esm', external: ['electron'] });
    expect(built.success, built.logs.join('\n')).toBe(true);
    const bundle = join(home, 'fixture.mjs');
    await Bun.write(bundle, built.outputs[0]!);
    const data = join(home, 'data');
    await mkdir(data);
    const env: NodeJS.ProcessEnv = { ...process.env, BROWSER_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = Bun.spawn([createRequire(import.meta.url)('electron') as string, bundle], {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    child = started;
    const [code, stdout, stderr] = await Promise.all([
      started.exited,
      new Response(started.stdout).text(),
      new Response(started.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result.google).toEqual({ url: 'https://accounts.google.com/finish', agent: result.firefox, text: 'complete' });
    expect(result.external).toEqual({ url: 'https://fixture.invalid/complete', agent: result.normal, text: 'complete' });
    expect(result.requests).toEqual([
      'https://fixture.invalid/enter',
      'https://accounts.google.com/finish',
      'https://accounts.google.com/leave',
      'https://fixture.invalid/complete',
    ]);
    expect(result.debugger).toBe(false);
  } finally {
    if (child !== undefined && child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    await rm(home, { recursive: true, force: true });
  }
});

import { readFileSync } from 'node:fs';
import { createServer as listen, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { CANDIDATES_PATH } from '@tagma/server/views/contract/wire/utilities';
import { surfaceConfig } from './surfaceConfig.js';

const APP = resolve(import.meta.dirname, '..');
const CANDIDATES = ['p-2', "content-['x']", 'data-[k="v"]:flex', 'w-[{1px}]'];

const isPlugin = (option: unknown): option is Plugin => typeof option === 'object' && option !== null && 'name' in option;

let backend: Server;
let vite: ViteDevServer;

beforeAll(async () => {
  backend = listen((request, response) => {
    response.statusCode = request.url === CANDIDATES_PATH ? 200 : 404;
    response.end(JSON.stringify({ candidates: CANDIDATES }));
  });
  await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done));
  const before = process.env.TAGMA_PORT;
  process.env.TAGMA_PORT = String((backend.address() as AddressInfo).port);
  const config = surfaceConfig();
  if (before === undefined) delete process.env.TAGMA_PORT;
  else process.env.TAGMA_PORT = before;
  const hostModules = (config.plugins ?? []).flat(Infinity).find((option) => isPlugin(option) && option.name === 'tagma-host-modules');
  const probe: Plugin = {
    name: 'window-component-probe',
    resolveId: (id) => (id === '/probe.js' ? id : null),
    load: (id) => (id === '/probe.js' ? "import 'svelte/internal/client';" : null),
  };
  vite = await createServer({
    configFile: false,
    root: APP,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    optimizeDeps: { include: ['svelte/internal/client'] },
    plugins: [hostModules as Plugin, probe],
  });
  await vite.environments.client.depsOptimizer?.scanProcessing;
});

afterAll(async () => {
  await vite.close();
  await new Promise((done) => backend.close(done));
});

test('a host module re-exports the URL a window component imports', async () => {
  const shim = await vite.transformRequest('/_app/host/svelte_internal_client.js');
  const component = await vite.transformRequest('/probe.js');
  const url = /export \* from "([^"]+)"/u.exec(shim?.code ?? '')?.[1];

  expect(url).toMatch(/svelte_internal_client\.js\?v=/u);
  expect(component?.code).toContain(`"${url}"`);
});

test('the shell carries the import map of every host module', () => {
  const imports = (JSON.parse(process.env.PUBLIC_HOST_MODULES ?? '{}') as { imports: Record<string, string> }).imports;

  expect(imports['svelte/internal/client']).toBe('/_app/host/svelte_internal_client.js');
  expect(imports['@runlith/tagma/ui']).toBe('/_app/host/runlith_tagma_ui.js');
  expect(readFileSync(resolve(APP, 'src/app.html'), 'utf8')).toContain('%sveltekit.env.PUBLIC_HOST_MODULES%');
});

test('the app stylesheet carries the plugin views candidates as @source inline', async () => {
  const transformed = await vite.transformRequest('/src/app.css');
  const css = JSON.parse(/const __vite__css = ("(?:[^"\\]|\\.)*")/u.exec(transformed?.code ?? '')?.[1] ?? '""') as string;

  expect(css).toContain(`@source inline("p-2 content-['x'] ");`);
  expect(css).toContain(`@source inline('data-[k="v"]:flex ');`);
  expect(css).not.toContain('{1px}');
});

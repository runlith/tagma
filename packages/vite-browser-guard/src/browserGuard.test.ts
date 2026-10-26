import { expect, test } from 'bun:test';
import { browserGuard } from './browserGuard';

const build = async (resolved: Record<string, string | null>, importers: Record<string, string[]>) => {
  const plugin = browserGuard();
  const context = {
    resolve: async (source: string) => (resolved[source] === null ? null : { id: resolved[source] ?? source }),
    getModuleInfo: (id: string) => ({ importers: importers[id] ?? [] }),
    error: (message: string): never => {
      throw new Error(message);
    },
    environment: { config: { root: '/app' } },
  };
  plugin.buildStart();
  for (const source of Object.keys(resolved)) await plugin.resolveId.call(context, source, '/node_modules/lib/index.js');
  await plugin.resolveId.call(context, 'node:path', undefined);
  plugin.buildEnd.call(context);
};

test('a built-in the client build could not turn into a file stops the build, naming the module, the importer and the chain to the page', async () => {
  const failure = build(
    { 'node:fs': 'node:fs', 'node:events': '/node_modules/events/index.js', lodash: null },
    { '/node_modules/lib/index.js': ['/app/src/lib/audio.ts'], '/app/src/lib/audio.ts': ['/app/src/routes/+page.svelte'] },
  );
  await expect(failure).rejects.toThrow(
    /node:fs is imported by \.\.\/node_modules\/lib\/index\.js\n\s+chain to the page: \.\.\/node_modules\/lib\/index\.js <- src\/lib\/audio\.ts <- src\/routes\/\+page\.svelte/,
  );
});

test("a polyfill installed under a built-in's bare name passes", async () => {
  await build({ events: '/node_modules/events/index.js', 'node:events': '/node_modules/events/index.js' }, {});
});

test('the guard judges the client environment alone', () => {
  const plugin = browserGuard();
  expect(plugin.applyToEnvironment({ config: { consumer: 'client' } })).toBe(true);
  expect(plugin.applyToEnvironment({ config: { consumer: 'server' } })).toBe(false);
});

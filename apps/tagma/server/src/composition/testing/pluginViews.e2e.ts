import { expect } from 'bun:test';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2e } from '@runlith/e2e/browser';
import { Effect } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { makeE2eWorld } from './e2eWorld.js';

const ENTRY = fileURLToPath(import.meta.resolve('@runlith/tagma/plugin'));
const SDK = resolve(dirname(ENTRY), '../..');
const CLI = join(dirname(ENTRY), 'cli.ts');

const DEFINITION = `import { definePlugin, tool, view } from '@runlith/tagma/plugin';

let count = 0;

export default definePlugin({
  id: 'counter',
  title: 'Counter',
  tools: {
    bump: tool({ description: 'Counts one more.', audience: 'view', run: async () => ({ count: ++count }) }),
  },
  views: { board: view('./ui/Board.svelte') },
  surfaces: [{ view: 'board', title: 'Counter' }],
});
`;

const BOARD = `<script lang="ts">
  import { Button, useTagma } from '@runlith/tagma/ui';
  import type plugin from '../plugin';

  const tagma = useTagma<typeof plugin>();
  let count = $state(0);
</script>

<p class="tracking-[0.37em]">Counted {count} in project {tagma.projectId}</p>
<Button onclick={async () => { count = (await tagma.tools.bump({})).count; }}>Bump</Button>
`;

const authored = (folder: string) =>
  Effect.promise(async () => {
    await rm(join(folder, 'plugin.test.ts'));
    await mkdir(join(folder, 'ui'), { recursive: true });
    await writeFile(join(folder, 'plugin.ts'), DEFINITION);
    await writeFile(join(folder, 'ui', 'Board.svelte'), BOARD);
    await mkdir(join(folder, 'node_modules', '@runlith'), { recursive: true });
    await mkdir(join(folder, 'node_modules', '@types'), { recursive: true });
    await symlink(SDK, join(folder, 'node_modules', '@runlith', 'tagma'));
    await symlink(join(SDK, 'node_modules', '@types', 'bun'), join(folder, 'node_modules', '@types', 'bun'));
    await symlink(join(SDK, 'node_modules', 'effect'), join(folder, 'node_modules', 'effect'));
  });

e2e.effect(
  'a Svelte view the SDK built draws in the window with its Button, calls its own tool, and its own class applies from the utilities sheet',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld();
      const tenant = yield* served.tenant;
      const folder = join(yield* served.world.directory('counter-plugin'), 'counter');
      const started = yield* Effect.orDie(
        spawnedEffect([process.execPath, CLI, 'init', folder, '--id', 'counter', '--title', 'Counter'], { stdin: 'ignore' }),
      );
      expect(started.success, started.stderr.toString()).toBe(true);
      yield* authored(folder);
      const built = yield* Effect.orDie(spawnedEffect([process.execPath, CLI, 'build', folder], { cwd: folder, stdin: 'ignore' }));
      expect(built.success, `${built.stdout.toString()}${built.stderr.toString()}`).toBe(true);
      yield* tenant.perform('install_plugin', { source: folder });
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/p/counter/board`);
        const imports = await page.evaluate(
          () => (JSON.parse(document.querySelector('script[type=importmap]')?.textContent ?? '{}') as { imports?: object }).imports ?? {},
        );
        expect(Object.keys(imports)).toEqual(expect.arrayContaining(['svelte', 'svelte/internal/client', '@runlith/tagma/ui']));
        const bump = page.getByRole('button', { name: 'Bump', exact: true });
        await bump.click();
        await page.getByText(`Counted 1 in project ${tenant.projectId}`).waitFor();
        await page.waitForFunction(() => {
          const counted = [...document.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Counted'));
          return counted !== undefined && getComputedStyle(counted).letterSpacing !== 'normal';
        });
        expect(await bump.evaluate((button) => Number.parseFloat(getComputedStyle(button).paddingLeft))).toBeGreaterThan(0);
      }).pipe(Effect.ensuring(Effect.ignore(tenant.perform('uninstall_plugin', { id: 'counter' }))));
    }),
);

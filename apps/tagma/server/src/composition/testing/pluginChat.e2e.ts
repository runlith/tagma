import { expect } from 'bun:test';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2e } from '@runlith/e2e/browser';
import { Effect, Stream } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { makeE2eWorld } from './e2eWorld.js';
import { scriptedModel } from './scriptedModel.js';

const ENTRY = fileURLToPath(import.meta.resolve('@runlith/tagma/plugin'));
const SDK = resolve(dirname(ENTRY), '../..');
const CLI = join(dirname(ENTRY), 'cli.ts');
const SAID = 'Thank you, desk.';
const REPLY = 'Gern geschehen.';

const DEFINITION = `import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { action, definePlugin, tool, view } from '@runlith/tagma/plugin';

export default definePlugin({
  id: 'trainer',
  title: 'Trainer',
  tools: {
    start: tool({
      description: 'Names the desk thread.',
      audience: 'view',
      run: async (_input, ctx) => ({ id: (await readFile(join(ctx.data, 'thread'), 'utf8')).trim() }),
    }),
  },
  actions: { translate: action({ title: 'Translate', run: async ({ args }) => args + ' auf Deutsch' }) },
  views: { desk: view('./ui/Desk.svelte'), helper: view('./ui/Helper.svelte'), broken: view('./ui/Broken.svelte') },
  surfaces: [{ view: 'desk', title: 'Desk' }],
  composer: [{ view: 'broken' }, { view: 'helper' }],
  commands: [{ name: 'translate', description: 'Translate into German', action: 'translate' }],
});
`;

const DESK = `<script lang="ts">
  import { Thread, useTagma } from '@runlith/tagma/ui';
  import type plugin from '../plugin';

  const tagma = useTagma<typeof plugin>();
  let id = $state<string | null>(null);
  void tagma.tools.start().then((made) => (id = made.id));
</script>

<h2>Desk</h2>
{#if id !== null}
  <div class="h-[32rem]"><Thread {id} /></div>
{/if}
`;

const HELPER = `<script lang="ts">
  import { Button, type ComposerFace } from '@runlith/tagma/ui';

  let { draft }: ComposerFace = $props();
</script>

<Button onclick={() => draft.insert('Hallo ')}>Say hallo</Button>
`;

const BROKEN = `<script lang="ts">
  throw new Error('the broken part fails on purpose');
</script>
`;

const drafted = (text: string) => `document.querySelector('textarea.prompt')?.value === ${JSON.stringify(text)}`;

const authored = (folder: string) =>
  Effect.promise(async () => {
    await rm(join(folder, 'plugin.test.ts'));
    await mkdir(join(folder, 'ui'), { recursive: true });
    await writeFile(join(folder, 'plugin.ts'), DEFINITION);
    await writeFile(join(folder, 'ui', 'Desk.svelte'), DESK);
    await writeFile(join(folder, 'ui', 'Helper.svelte'), HELPER);
    await writeFile(join(folder, 'ui', 'Broken.svelte'), BROKEN);
    await mkdir(join(folder, 'node_modules', '@runlith'), { recursive: true });
    await mkdir(join(folder, 'node_modules', '@types'), { recursive: true });
    await symlink(SDK, join(folder, 'node_modules', '@runlith', 'tagma'));
    await symlink(join(SDK, 'node_modules', '@types', 'bun'), join(folder, 'node_modules', '@types', 'bun'));
    await symlink(join(SDK, 'node_modules', 'effect'), join(folder, 'node_modules', 'effect'));
  });

e2e.effect(
  'a plugin’s section places a whole thread the person sends from, a composer part fills the draft beside one that fails alone, and a command fills it with its action’s answer',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld({ models: scriptedModel(Stream.succeed(REPLY)) });
      const tenant = yield* served.tenant;
      const folder = join(yield* served.world.directory('trainer-plugin'), 'trainer');
      const started = yield* Effect.orDie(
        spawnedEffect([process.execPath, CLI, 'init', folder, '--id', 'trainer', '--title', 'Trainer'], { stdin: 'ignore' }),
      );
      expect(started.success, started.stderr.toString()).toBe(true);
      yield* authored(folder);
      const built = yield* Effect.orDie(spawnedEffect([process.execPath, CLI, 'build', folder], { cwd: folder, stdin: 'ignore' }));
      expect(built.success, `${built.stdout.toString()}${built.stderr.toString()}`).toBe(true);
      yield* tenant.perform('install_plugin', { source: folder });
      const thread = yield* tenant.thread({ title: 'Desk thread' });
      const data = join(served.world.dataHome, 'agent-plugin-data', 'trainer', 'projects', String(tenant.projectId));
      yield* Effect.promise(() => mkdir(data, { recursive: true }).then(() => writeFile(join(data, 'thread'), thread.id)));
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/p/trainer/desk`);
        const composer = page.locator('textarea.prompt');
        await composer.waitFor();
        await page.getByText('This view stopped').waitFor();
        await page.getByRole('button', { name: 'Say hallo', exact: true }).click();
        await page.waitForFunction(drafted('Hallo '));

        await composer.fill('/trainer-translate');
        await composer.press('Enter');
        const words = page.getByLabel('Words');
        await words.fill('good morning');
        await words.press('Enter');
        await page.waitForFunction(drafted('good morning auf Deutsch'));

        await composer.fill(SAID);
        await composer.press('Enter');
        await page.getByText(SAID, { exact: true }).waitFor();
        await page.getByText(REPLY, { exact: true }).waitFor();
      }).pipe(Effect.ensuring(Effect.ignore(tenant.perform('uninstall_plugin', { id: 'trainer' }))));
    }),
  { context: { viewport: { width: 1280, height: 800 } } },
);

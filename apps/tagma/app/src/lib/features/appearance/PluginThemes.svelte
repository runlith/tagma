<script lang="ts">
  import { THEMES_POINT, themeIdOf } from '@tagma/server/appearance/contract/wire/format';
  import type { PluginComponent } from '@tagma/server/plugins/contract/wire/rows';
  import Swatches from '$lib/features/settings/controls/Swatches.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Appearance } from './Appearance.svelte.js';

  let {
    plugin,
    components,
    runEverywhere,
  }: { plugin: string; components: readonly PluginComponent[]; runEverywhere: () => Promise<boolean> } = $props();

  const appearance = Appearance.use();

  const themes = $derived(
    (components.find((component) => component.kind === 'contribution' && component.name === THEMES_POINT)?.entries ?? []).map((entry) => {
      const id = themeIdOf(plugin, entry.name);
      return { id, title: entry.title, offered: appearance.themes.find((one) => one.id === id) };
    }),
  );

  let starting = $state(false);

  async function use(id: string, offered: boolean): Promise<void> {
    if (!offered) {
      starting = true;
      const running = await runEverywhere();
      starting = false;
      if (!running) return;
    }
    appearance.chooseTheme(id);
  }
</script>

{#if themes.length > 0}
  <section class="grid gap-2" aria-label="Themes" data-plugin-themes={plugin}>
    <h3 class="text-small font-medium text-muted-foreground">Themes</h3>
    <div class="grid divide-y rounded-lg border bg-raised">
      {#each themes as theme (theme.id)}
        <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-small" data-theme={theme.id}>
          {#if theme.offered !== undefined}<Swatches colours={appearance.coloursOf(theme.offered.theme)} />{/if}
          <FadeText class="min-w-0 flex-1" text={theme.title} />
          {#if appearance.chosen === theme.id && theme.offered !== undefined}
            <span class="shrink-0 text-muted-foreground">In use</span>
          {:else}
            <Button variant="outline" size="xs" disabled={starting} onclick={() => void use(theme.id, theme.offered !== undefined)}
              >Use</Button
            >
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
